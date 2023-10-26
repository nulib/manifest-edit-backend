import * as apigateway from "aws-cdk-lib/aws-apigateway";
// import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamoDB from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";

export class ManifestEditorBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, "ManifestEditorUsers", {
      selfSignUpEnabled: false,
      mfa: cognito.Mfa.OFF,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const manifestsTable = new dynamoDB.Table(this, "Manifests", {
      partitionKey: {
        name: "id",
        type: dynamoDB.AttributeType.STRING,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new apigateway.RestApi(this, "ManifestEditorApi", {});
    api.root.addMethod("ANY");

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "ManifestEditorAuth",
      {
        cognitoUserPools: [userPool],
      }
    );

    const manifestResources = api.root.addResource("manifests");

    const manifestsResourcesGETMethod = manifestResources.addMethod(
      "GET",
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": JSON.stringify({
                manifests: [
                  {
                    id: "1",
                    title: "Manifest 1",
                    description: "Manifest 1 description",
                  },
                ],
              }),
            },
          },
        ],
      }),
      {
        methodResponses: [{ statusCode: "200" }],
        authorizer,
      }
    );

    // api.root.addMethod("ANY");

    // const manifestResources = api.root.addResource("manifests");
    // manifestResources.addMethod("GET");

    // const auth = new apigateway.CognitoUserPoolsAuthorizer(
    //   this,
    //   "booksAuthorizer",
    //   {
    //     cognitoUserPools: [userPool],
    //   }
    // );

    // declare const books: apigateway.Resource;
    // books.addMethod("GET", new apigateway.HttpIntegration("http://amazon.com"), {
    //   authorizer: auth,
    //   authorizationType: apigateway.AuthorizationType.COGNITO,
    // });

    // const auth = new apigateway.CognitoUserPoolsAuthorizer(
    //   this,
    //   "ManifestEditorAuth",
    //   {
    //     cognitoUserPools: [userPool],
    //   }
    // );
  }
}
