
module.exports = async function handleNodeLambda(lambdaZip, envFileName, envParams) {
  if (!envFileName) {
    envFileName = 'env.js'
  }

  const fileContents = `
const envVars = ${JSON.stringify(envParams, null, 2)};

for (const [key, val] of Object.entries(envVars)) {
  process.env[key] = val;
}

module.exports = envVar;
`

  try {
    lambdaZip.file(envFileName, fileContents)
  }
  catch (e) {
    throw new Error(`Failed to write environment file '${envFileName}' to zip. Error: ${e.message}`)
  }
}
