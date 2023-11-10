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
      autoVerify: {
        email: true,
      },
    });

    userPool.addClient("ManifestEditClient", {
      userPoolClientName: "ManifestEditClient",
      authFlows: {
        userPassword: true,
        adminUserPassword: true,
        userSrp: true,
      },
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
      oAuth: {}
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

    const api = new apigateway.RestApi(this, "ManifestEditorApi", {
      defaultCorsPreflightOptions: {
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
        statusCode: 200,
        allowMethods: ["OPTIONS", "GET", "POST", "DELETE", "PUT"],
        allowCredentials: true,
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
      },
      deploy: true,
    });
    api.root.addMethod("ANY");

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "ManifestEditorAuth",
      {
        cognitoUserPools: [userPool],
      }
    );

    // list all manifest metadata
    const manifestListResource = api.root.addResource("manifests");

    const manifestListFunction = new lambda.Function(this, "listManifests", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambdas/manifests")
      ),
      environment: {
        MANIFESTS_TABLE: manifestsTable.tableName,
      },
    });

    manifestListFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:Scan"],
        resources: [manifestsTable.tableArn],
      })
    );

    manifestListResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(manifestListFunction),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // retrieve single item by partition key + sort key
    // could be either manifest metatdata or transcription/translation
    const manifestItemResource = api.root.addResource("item");

    const getManifestItemFunction = new lambda.Function(this, "getItem", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambdas/item")),
      environment: {
        MANIFESTS_TABLE: manifestsTable.tableName,
      },
    });

    getManifestItemFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem"],
        resources: [manifestsTable.tableArn],
      })
    );

    const itemKeys = new apigateway.Model(this, "itemKeys", {
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          uri: { type: apigateway.JsonSchemaType.STRING },
          sortKey: {
            type: apigateway.JsonSchemaType.STRING,
            pattern: "^(METADATA|TRANSCRIPTION#.+|TRANSLATION#.+)$",
          },
        },
        required: ["uri", "sortKey"],
      },
    });

    manifestItemResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(getManifestItemFunction),
      {
        requestModels: {
          "application/json": itemKeys,
        },
        requestValidatorOptions: {
          validateRequestBody: true,
        },
        authorizer,
      }
    );

    // add/update/delete  metadata
    const metadataResource = api.root.addResource("metadata");

    const metadataFunction = new lambda.Function(this, "metadata", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambdas/metadata")
      ),
      environment: {
        MANIFESTS_TABLE: manifestsTable.tableName,
      },
    });

    metadataFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:DeleteItem",
          "dynamodb:UpdateItem",
          "dynamodb:PutItem",
        ],
        resources: [manifestsTable.tableArn],
      })
    );

    const metadataRequest = new apigateway.Model(this, "metadataRequest", {
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          uri: { type: apigateway.JsonSchemaType.STRING },
          sortKey: { enum: ["METADATA"] },
          label: { type: apigateway.JsonSchemaType.STRING },
          provider: { enum: ["Northwestern", "UIUC"] },
          public: { type: apigateway.JsonSchemaType.BOOLEAN },
        },
        required: ["uri", "sortKey", "label", "provider", "public"],
      },
    });

    metadataResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(metadataFunction),
      {
        requestModels: {
          "application/json": metadataRequest,
        },
        requestValidatorOptions: {
          validateRequestBody: true,
        },
        authorizer,
      }
    );

    metadataResource.addMethod(
      "PUT",
      new apigateway.LambdaIntegration(metadataFunction),
      {
        requestModels: {
          "application/json": metadataRequest,
        },
        requestValidatorOptions: {
          validateRequestBody: true,
        },
        authorizer,
      }
    );

    const metadataKeys = new apigateway.Model(this, "metadataKeys", {
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          uri: { type: apigateway.JsonSchemaType.STRING },
          sortKey: { enum: ["METADATA"] },
        },
        required: ["uri", "sortKey"],
      },
    });

    metadataResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(metadataFunction),
      {
        requestModels: {
          "application/json": metadataKeys,
        },
        requestValidatorOptions: {
          validateRequestBody: true,
        },
        authorizer,
      }
    );

    // ADD/UPDATE/DELETE ANNOTATIONS
    const annotationResource = api.root.addResource("annotation");

    const annotationFunction = new lambda.Function(this, "annotation", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambdas/annotation")
      ),
      environment: {
        MANIFESTS_TABLE: manifestsTable.tableName,
      },
    });

    annotationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:DeleteItem",
          "dynamodb:UpdateItem",
          "dynamodb:PutItem",
        ],
        resources: [manifestsTable.tableArn],
      })
    );

    const annotationRequest = new apigateway.Model(this, "annotationRequest", {
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          uri: { type: apigateway.JsonSchemaType.STRING },
          sortKey: {
            type: apigateway.JsonSchemaType.STRING,
            pattern: "^(TRANSCRIPTION#|TRANSLATION#).+$",
          },
          value: { type: apigateway.JsonSchemaType.STRING },
        },
        required: ["uri", "sortKey", "value"],
      },
    });

    annotationResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(annotationFunction),
      {
        requestModels: {
          "application/json": annotationRequest,
        },
        requestValidatorOptions: {
          validateRequestBody: true,
        },
        authorizer,
      }
    );

    annotationResource.addMethod(
      "PUT",
      new apigateway.LambdaIntegration(annotationFunction),
      {
        requestModels: {
          "application/json": annotationRequest,
        },
        requestValidatorOptions: {
          validateRequestBody: true,
        },
        authorizer,
      }
    );

    const annotationKeys = new apigateway.Model(this, "annotationKeys", {
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          uri: { type: apigateway.JsonSchemaType.STRING },
          sortKey: {
            type: apigateway.JsonSchemaType.STRING,
            pattern: "^(TRANSCRIPTION#|TRANSLATION#).+$",
          },
        },
        required: ["uri", "sortKey"],
      },
    });

    annotationResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(annotationFunction),
      {
        requestModels: {
          "application/json": annotationKeys,
        },
        requestValidatorOptions: {
          validateRequestBody: true,
        },
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
