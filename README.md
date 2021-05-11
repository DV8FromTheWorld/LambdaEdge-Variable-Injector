# Lambda@Edge Environment Variable Injector
A simple custom resource for adding environment variable support to Lambda@Edge.

## Why
Per the [official documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-requirements-limits.html)
environment variables are not supported in AWS Lambda@Edge. There are [some](https://stackoverflow.com/a/58101487) 
[possible](https://stackoverflow.com/a/54829145) [workarounds](https://aws.amazon.com/blogs/networking-and-content-delivery/leveraging-external-data-in-lambdaedge/),
however each requires leveraging of external AWS constructs to enable environment-variable-like data passing or requires
maintaining or building multiple versions of your code to simulate what environment varaibles are _meant_ to do.

This solution aims to allow the developer to use environments variables as expected in normal lambdas:
 - Defined in Cloudformation
 - Retrieved from the language standardized environment constructs
   - Node: `process.env[KEY]`
   - Python: `os.environ[KEY]`

## How
This custom resource retrieves your Node or Python lambda's payload zip from S3, injects a file into the payload
that contains your defined Environment Variables, re-zips the contents and uploads to S3. It then exposes the 
S3 bucket and S3 key of the uploaded modified payload in cloudformation (via `Fn::GetAtt`) for use in lambda definitions.

## Example

```yaml
Resources:
  InjectEnvVariables:
    Type: Custom::InjectEnvironmentVariables
    Properties:
      ServiceToken: !Sub 'arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:your-global-lambda-edge-variable-injector'
      LambdaBucket: 'your-asset-bucket'
      LambdaKey: 'path/to/your/lambda/payload.zip'
      PayloadLanguage: 'node'
      EnvironmentVariables:
        IsSomeone: "Getting"
        TheBest: "TheBest, TheBest, TheBest"
        Of: "You"
  
  LambdaAtEdge:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      CodeUri:
        Bucket: !GetAtt InjectEnvVariables.LambdaBucket
        Key: !GetAtt InjectEnvVariables.LambdaKey
      Runtime: 'nodejs14.x'
```
Thus, when `LambdaAtEdge` does `require('./env.js`), the provided environment variables will be loaded into `process.env`

|                          |                                |
| ------------------------ | ------------------------------ |
| `process.env.IsSomeone`  | `"Getting"`                    |
| `process.env.TheBest`    | `"TheBest, TheBest, TheBest"`  |
| `process.env.Of`         | `"You"`                        |

## API

### `OutputBucket`
Defines the S3 bucket which the modified payload zip will be uploaded to. This value will override the `OUTPUT_BUCKET`
environment variable set on the Custom Resource lambda itself if one was set on the global declaration of the resource.
If there was no `OUTPUT_BUCKET` environment variable set on the global declaration then this parameter **is required**.
- Type: `string`
- Required: `conditionally`

### `LambdaBucket`
Defines the source S3 bucket where the payload zip resides. This value should correspond to what you would have put
for [Lambda.Code.S3Bucket](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-code.html#cfn-lambda-function-code-s3bucket).
- Type: `string`
- Required: `yes`

### `LambdaKey`
Defines the source S3 key of the zip file. This value should correspond to what you would have put
for [Lambda.Code.S3Key](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-code.html#cfn-lambda-function-code-s3key).
- Type: `string`
- Required: `yes`

### `PayloadLanguage`
Defines what language is being used in provided lambda payload.
- Type: `string`
- Required: `yes`
- Allowed Values:
    - `"node"`
    - `"python"`

### `EnvironmentVariables`
An object defining the environment variables that should be made available to the lambda. This value should 
correspond to what you would have put for [Lambda.Environment.Variables](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-environment.html#cfn-lambda-function-environment-variables).
- Type: `object<string, string>`
- Required: `yes`

### `EnvironmentFile`
_Optional_ 
<br />Defines the name of the environment variable file that is injected into the lambda payload. This value **should include** 
the language-specific file extension (`.js` / `.py`).
- Type: `string`
- Required: `no`
- Default:
  - Node: `env.js`
  - Python: `env.py`  
