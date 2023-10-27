import * as apigateway from "aws-cdk-lib/aws-apigateway";
// import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamoDB from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "node:path";

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

    const helloResource = api.root.addResource("hello");

    const helloFunction = new lambda.Function(this, "HelloFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: this.bundleAssets("../../lambdas/hello"),
      environment: {
        MANIFESTS_TABLE: manifestsTable.tableName,
      },
    });

    helloFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem"],
        resources: [manifestsTable.tableArn],
      })
    );

    const helloResourcesGETMethod = helloResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(helloFunction),
      {
        authorizer,
      }
    );

    const deployment = new apigateway.Deployment(this, "Deployment", { api });
    const stage = new apigateway.Stage(this, "latest", {
      deployment,
      stageName: "latest",
    });

    console.log(stage.urlForPath("/hello"));
  }

  bundleAssets(codePath: string): lambda.Code {
    return lambda.Code.fromAsset(path.join(__dirname, codePath), {
      bundling: {
        image: lambda.Runtime.NODEJS_18_X.bundlingImage,
        user: "root",
        command: [
          "bash",
          "-c",
          [
            "cp -rT /asset-input/ /asset-output/",
            "cd /asset-output",
            "npm ci --omit=dev",
            "chown -R 1000:1000 .",
          ].join(" && "),
        ],
      },
    });
  }
}
