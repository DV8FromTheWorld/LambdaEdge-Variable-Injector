
module.exports = async function handlePythonLambda(lambdaZip, envFileName, envParams) {
  if (!envFileName) {
    envFileName = 'env.py'
  }

  const fileContents = `
import os

env_vars = ${JSON.stringify(envParams, null, 2)}

for key, value in env_vars.items():
  os.environ[key] = value
`

  try {
    lambdaZip.file(envFileName, fileContents)
  }
  catch (e) {
    throw new Error(`Failed to write environment file '${envFileName}' to zip. Error: ${e.message}`)
  }
}
