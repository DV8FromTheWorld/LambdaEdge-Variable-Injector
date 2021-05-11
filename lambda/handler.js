const AWS           = require('aws-sdk')
const JSZip         = require('jszip')
const StreamBuffers = require('stream-buffers')

const handleNodeLambda   = require('./language-payloads/node')
const handlePythonLambda = require('./language-payloads/python')

const s3 = new AWS.S3()

const handledLanguages = {
  'node':   handleNodeLambda,
  'python': handlePythonLambda
}

/**
 * Handles Cloudformation CREATE and UPDATE events to modify a provided lambda payload
 *  to inject environment variable information into the payload for use.
 *
 * @param {object} event - The cloudformation custom resource event
 *
 * @returns {Promise<S3PayloadResponse>} - A promise resolving to an object containing details on
 *                                         the uploaded modified payload zip file.
 */
async function handleCreateAndUpdate(event) {
  //Output the ResponseURL in the logs so that in case something breaks in a way that the code doesn't handle
  // we will have the URL to call to force cloudformation to continue instead of hang around forever.
  console.log("Will respond to cloudformation with url: " + event.ResponseURL)

  const {
    outputBucket,
    lambdaBucket,
    lambdaKey,
    payloadLang,
    envParams,
    envFileName
  } = getParameters(event)

  //Retrieve the language-specific handling function
  const handleLambda = handledLanguages[payloadLang]
  if (!handleLambda) {
    const formattedAllowedLanguages = Object.keys(handledLanguages)
      .map(lang => `'${lang}'`)
      .join(', ')

    throw new Error(`Unrecognized 'PayloadLanguage' provided. Provided: '${payloadLang}'. Allowed: [${formattedAllowedLanguages}]`)
  }

  //Modify the lambda payload to include the environment variable file
  const lambdaZip = await getLambdaZip(lambdaBucket, lambdaKey)
  await handleLambda(lambdaZip, envFileName, envParams)

  //Upload the modified Lambda payload to S3 so that it can be referenced.
  const newLambdaKey = `${lambdaKey}--env/${new Date().toISOString()}.zip`
  try {
    await uploadZipToS3(lambdaZip, outputBucket, newLambdaKey)
  }
  catch (e) {
    return throw new Error(`Failed to upload new zip. Error: ${e.message}. SrcBucket: '${lambdaBucket}', SrcKey: '${lambdaKey}', NewBucket: '${outputBucket}', NewKey: '${newLambdaKey}'`)
  }

  //Export data about the modified payload for use in other lambda definitions
  return {
    LambdaBucket: outputBucket,
    LambdaKey: newLambdaKey
  }
}

/**
 * Helper function to process, validate, and return the parameters provided to the custom resource.
 *
 * @param {object} event - The cloudformation custom resource event
 *
 * @returns {HandlerParameters}
 */
function getParameters(event) {
  const properties   = event.ResourceProperties || {}
  const lambdaBucket = properties.LambdaBucket
  const lambdaKey    = properties.LambdaKey
  const payloadLang  = properties.PayloadLanguage
  const envParams    = properties.EnvironmentVariables
  const envFileName  = properties.EnvironmentFile || null

  const outputBucket = properties.OutputBucket || process.env.OUTPUT_BUCKET

  if (!lambdaBucket) throw new Error("Was not provided the 'LambdaBucket' ResourceProperty.")
  if (!lambdaKey)    throw new Error("Was not provided the 'LambdaKey' ResourceProperty.")
  if (!payloadLang)  throw new Error("Was not provided the 'PayloadLanguage' ResourceProperty.")
  if (!envParams)    throw new Error("Was not provided the 'EnvironmentVariables' ResourceProperty.")

  if (!outputBucket) throw new Error("No 'OutputBucket' was specified. One can be provided globally via the "
    + "VariableInjector definition's EnvironmentVariables.OUTPUT_BUCKET_NAME or locally via CustomResource.Properties.OutputBucket")

  if (typeof lambdaBucket !== 'string')  throw new Error("Type of 'LambdaBucket' must be a String")
  if (typeof lambdaKey !== 'string')     throw new Error("Type of 'LambdaKey' must be a String")
  if (typeof payloadLang !== 'string')   throw new Error("Type of 'PayloadLanguage' must be a String")
  if (typeof outputBucket !== 'string')  throw new Error("Type of 'OutputBucket' must be a String")

  if (typeof envParams !== 'object' || Array.isArray(envParams)) {
    throw new Error(`The 'EnvironmentVariables' property must be an Object of KeyValue pairs.`)
  }

  for (const [key, val] of Object.entries(envParams)) {
    if (typeof val !== 'string') {
      throw new Error(`EnvironmentVariables must be of type string. 'EnvironmentVariables.${key}' is not of type string.`)
    }
  }

  return {
    outputBucket,
    lambdaBucket,
    lambdaKey,
    payloadLang,
    envParams,
    envFileName
  }
}

/**
 * Retrieves the lambda payload zip file from S3 and loads it into a JSZip
 *  construct for manipulation of the contents of the zip in memory.
 *
 * @param {string} lambdaBucket - The S3 bucket containing the lambda payload zip
 * @param {string} lambdaKey - The S3 file that is the lambda payload zip
 *
 * @returns {Promise<JSZip>} - A promise that results to the JSZip construct representing the file contents
 *                             if it was successfully downloaded from S3 and parsed as a zip.
 */
async function getLambdaZip(lambdaBucket, lambdaKey) {
  let lambdaZipRaw
  try {
    const response = await s3.getObject({
      Bucket: lambdaBucket,
      Key: lambdaKey
    }).promise()

    lambdaZipRaw = response.Body
  }
  catch (e) {
    console.error(e)
    return throw new Error(`Could not find zip file in S3. Bucket: '${lambdaBucket}', Key: '${lambdaKey}'`)
  }

  let lambdaZip
  try {
    lambdaZip = await JSZip.loadAsync(lambdaZipRaw)
  }
  catch (e) {
    console.error(e)
    throw new Error(`URL pointed to a file that could not be understood as a zip. Bucket: '${lambdaBucket}', Key: '${lambdaKey}'`)
  }

  return lambdaZip
}

/**
 * Consumes a JSZip construct and uploads it to an S3 bucket as a zip file using the provided fileName as the key.
 *
 * @param {JSZip} zip - The zip construct to convert and upload as a zip file
 * @param {string} outputBucket - The S3 destination bucket for the zip file
 * @param {string} fileName - The S3 destination key for the zip file
 *
 * @returns {Promise<void>} - A promise that resolves after the zip has been uploaded to S3
 */
async function uploadZipToS3(zip, outputBucket, fileName) {
  const zipAsBuffer = await getZipBuffer(zip)
  await s3.putObject({
    Bucket: outputBucket,
    Key: fileName,
    Body: zipAsBuffer
  })
  .promise()
}

/**
 * Translated the JSZip construct to a standard zip file format and returns the data as a Buffer.
 *
 * @param {JSZip} zip - The zip construct to convert to raw data
 *
 * @returns {Promise<Buffer>} - Promise that resolves to a [Buffer](https://nodejs.org/api/buffer.html) containing the
 *                              data contents of the zip.
 */
async function getZipBuffer(zip) {
  const outputBuffer = new StreamBuffers.WritableStreamBuffer();

  return new Promise((resolve, reject) => {
    zip.generateNodeStream({type: 'nodebuffer', streamFiles: true})
      .pipe(outputBuffer)
      .on('error', reject)
      .on('finish', () => {
        resolve(outputBuffer.getContents())
      })
  })
}

module.exports = {
  handleCreateAndUpdate
}

/// Type Definitions

/**
 * @typedef S3PayloadResponse
 * @type {object}
 *
 * @property {string} LambdaBucket
 * @property {string} LambdaKey
 */

/**
 * @typedef HandlerParameters
 * @typedef {object}
 *
 * @property {string} outputBucket
 * @property {string} lambdaBucket
 * @property {string} lambdaKey
 * @property {string} payloadLang
 * @property {object<string, string>} envParams
 * @property {string} envFileName
 */
