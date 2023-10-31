import * as amplify from "@aws-cdk/aws-amplify-alpha";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamoDB from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "node:path";

import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

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
        name: "uri",
        type: dynamoDB.AttributeType.STRING,
      },
      sortKey: {
        name: "sortKey",
        type: dynamoDB.AttributeType.STRING,
      },
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

    helloResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(helloFunction),
      {
        authorizer,
      }
    );

    const manifestListResource = api.root.addResource("manifestList");

    const manifestListFunction = new lambda.Function(
      this,
      "ManifestListFunction",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.handler",
        code: this.bundleAssets("../../lambdas/manifestList"),
        environment: {
          MANIFESTS_TABLE: manifestsTable.tableName,
        },
      }
    );

    manifestListFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:Query"],
        resources: [manifestsTable.tableArn],
      })
    );

    manifestListResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(manifestListFunction),
      {
        authorizer,
      }
    );

    const deployment = new apigateway.Deployment(this, "Deployment", { api });
    const stage = new apigateway.Stage(this, "latest", {
      deployment,
      stageName: "latest",
    });

    const role = new Role(this, "AmplifyRoleWebApp", {
      assumedBy: new ServicePrincipal("amplify.amazonaws.com"),
      description: "Custom role permitting resources creation from Amplify",
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess-Amplify"),
      ],
    });

    const amplifyApp = new amplify.App(this, "ManifestEditorUI", {
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: "nulib",
        repository: "manifest-edit-ui",
        oauthToken: cdk.SecretValue.secretsManager("cdk/deploy-config", {
          jsonField: "github-token",
        }),
      }),
      role,
      description: "Manifest Editor UI",
      autoBranchCreation: {
        patterns: ["deploy/*", "preview/*"],
        autoBuild: true,
      },
      autoBranchDeletion: true,
    });

    amplifyApp.addBranch("main", {
      autoBuild: true,
      stage: "PRODUCTION",
    });
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
