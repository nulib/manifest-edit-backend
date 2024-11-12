# manifest-edit-backend

AWS CDK Typescript infrastructure for deploying a manifest editor administrative UI.

Project consists of two parts:

- UI (code lives here https://github.com/nulib/manifest-edit-ui) - is a React application which will be deployed to AWS Amplify
- Admin API which provides routes to the UI:

```
/manifests
  - GET (retrieve list of manifest metadata)
/item
  - POST (retrieve single item by key (annotation, note, canvas, or metadata))
/annotation
  - POST (create annotation)
  - PUT (update annotation)
  - DELETE (delete annotation)
/canvas
  - POST (create canvas)
  - PUT (update canvas)
/metadata
  - POST (create manifest metadata)
  - PUT (update manifest metadata)
  - DELETE (delete manifest metadata)
/publish
 - POST (publish collection and manifest files as IIIF/JSON)
```

## Usage

**Deployment**

Create a secret in AWS Secrets Manager called `cdk/deploy-config` with string values for:

```
  - wildcardCertificateArn
  - deployBranch
  - publishStateMachineArn
  - baseDomainName
  - github-token
  - weaviate-host
  - weaviate-api-key
  - azure-openai-api-key
  - dcapi-endpoint
  - textract-bucket-arn
```

```bash
cd cdk

# To deploy Amplify app, Cognito user pool, API gateway, DynamoDB and lambda resources
cdk deploy ManifestEditorBackend

```

## License

- [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
