import * as amplify from "@aws-cdk/aws-amplify-alpha";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamoDB from "aws-cdk-lib/aws-dynamodb";
import * as fs from "fs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as path from "node:path";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";

import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

import { Construct } from "constructs";
import { aws_certificatemanager as acm } from "aws-cdk-lib";
import { aws_stepfunctions as stepfunctions } from "aws-cdk-lib";

interface ManifestEditorBackendStackProps extends cdk.StackProps {
  wildcardCertificateArn: string;
  deployBranch: string;
  baseDomainName: string;
  githubToken: string;
  manifestBucket: string;
}
export class ManifestEditorBackendStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: ManifestEditorBackendStackProps
  ) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, "ManifestEditorUsers", {
      selfSignUpEnabled: false,
      mfa: cognito.Mfa.OFF,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoVerify: {
        email: true,
      },
    });

    const userPoolClient = userPool.addClient("ManifestEditClient", {
      userPoolClientName: "ManifestEditClient",
      authFlows: {
        userPassword: true,
        adminUserPassword: true,
        userSrp: true,
      },
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
      oAuth: {},
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
      pointInTimeRecovery: true,
    });

    const hostedZone = route53.HostedZone.fromLookup(this, "hostedZone", {
      domainName: props.baseDomainName,
    });

    console.log("hostedZone", hostedZone.zoneName);

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "Certificate",
      props.wildcardCertificateArn
    );

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
      domainName: {
        domainName: `api-maktaba.${hostedZone.zoneName}`,
        certificate: certificate,
      },
    });
    api.root.addMethod("ANY");

    const aliasRecord = new route53.ARecord(
      this,
      "maktabaAdminApiAliasRecord",
      {
        target: route53.RecordTarget.fromAlias(
          new cdk.aws_route53_targets.ApiGateway(api)
        ),
        zone: hostedZone,
        recordName: `api-maktaba.${hostedZone.zoneName}`,
      }
    );

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
      code: this.bundleAssets("../../lambdas/metadata"),
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
          publicStatus: { type: apigateway.JsonSchemaType.BOOLEAN },
        },
        required: ["uri", "sortKey", "label", "provider", "publicStatus"],
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
        oauthToken: cdk.SecretValue.secretsManager("maktaba/deploy-config", {
          jsonField: "githubToken",
        }),
      }),
      role,
      description: "Manifest Editor UI",
      autoBranchCreation: {
        patterns: ["deploy/*", "preview/*"],
        autoBuild: true,
      },
      autoBranchDeletion: true,
      environmentVariables: {
        "VITE_REGION": "us-east-1",
        "VITE_USER_POOL_ID": userPool.userPoolId,
        "VITE_USER_POOL_APP_CLIENT_ID": userPoolClient.userPoolClientId,
        "VITE_API_GATEWAY_ENDPOINT": `https://api-maktaba.${hostedZone.zoneName}`
      }
    });

    const appDomain = amplifyApp.addDomain(
      `admin-maktaba.${hostedZone.zoneName}`,
      {
        enableAutoSubdomain: true,
        autoSubdomainCreationPatterns: ["preview/*"],
      }
    );

    const deployBranch = amplifyApp.addBranch(props.deployBranch, {
      autoBuild: true,
      stage: "PRODUCTION",
    });

    appDomain.mapRoot(deployBranch);
    appDomain.mapSubDomain(deployBranch, "www");

    const bucket = new s3.Bucket(this, "assetsBucket", {
      bucketName: props.manifestBucket,
      accessControl: s3.BucketAccessControl.PRIVATE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      versioned: true,
    });
    
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "CFOriginAccessIdentity"
    );
    bucket.grantRead(originAccessIdentity);

    const iiifAssetsDomainName = `iiif-maktaba.${props.baseDomainName}`;

    const distribution = new cloudfront.Distribution(this, "CFDistribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, { originAccessIdentity }),
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy
            .CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      domainNames: [iiifAssetsDomainName],
      certificate: certificate,
    });

    const _aliasRecord = new route53.ARecord(
      this,
      "CloudFrontDistAliasRecord",
      {
        target: route53.RecordTarget.fromAlias(
          new cdk.aws_route53_targets.CloudFrontTarget(distribution)
        ),
        zone: hostedZone,
        recordName: iiifAssetsDomainName,
      }
    );

    const writeManifestFunction = new lambda.Function(this, "writeManifest", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: this.bundleAssets("../../lambdas/writeManifest"),
      environment: {
        BASE_URL: `https://${iiifAssetsDomainName}`,
        BUCKET: bucket.bucketName,
        MANIFEST_TABLE_NAME: manifestsTable.tableName,
      },
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
    });

    writeManifestFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:PutObject", "s3:PutObjectAcl"],
        resources: [`${bucket.bucketArn}/*`, bucket.bucketArn],
      })
    );

    writeManifestFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem"],
        resources: [
          `arn:aws:dynamodb:us-east-1:${this.account}:table/${manifestsTable.tableName}`,
        ],
      })
    );

    const writeCollectionFunction = new lambda.Function(
      this,
      "writeCollection",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.handler",
        code: this.bundleAssets("../../lambdas/writeCollection"),
        environment: {
          BASE_URL: `https://${iiifAssetsDomainName}`,
          BUCKET: bucket.bucketName,
          MANIFEST_TABLE_NAME: manifestsTable.tableName,
        },
        timeout: cdk.Duration.minutes(1),
        memorySize: 512,
      }
    );

    writeCollectionFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:PutObject", "s3:PutObjectAcl"],
        resources: [`${bucket.bucketArn}/*`, bucket.bucketArn],
      })
    );

    const publishStateMachineRole = new iam.Role(
      this,
      "manifestPublishStateMachine",
      {
        assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
        description: "Role for Manifest Editor Publish State Machine",
      }
    );

    writeCollectionFunction.grantInvoke(publishStateMachineRole);
    writeManifestFunction.grantInvoke(publishStateMachineRole);
    distribution.grantCreateInvalidation(publishStateMachineRole);

    publishStateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem",
        ],
        resources: [
          `arn:aws:dynamodb:us-east-1:${this.account}:table/${manifestsTable.tableName}`,
        ],
      })
    );

    publishStateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ],
        resources: ["*"],
      })
    );

    const cfnStateMachineProps: stepfunctions.CfnStateMachineProps = {
      roleArn: publishStateMachineRole.roleArn,
      definitionString: fs
        .readFileSync("../state-machines/publish-definition.asl.json")
        .toString(),
      definitionSubstitutions: {
        manifestTableName: `${manifestsTable.tableName}`,
        writeManifestFunctionName: `${writeManifestFunction.functionName}:$LATEST`,
        writeCollectionFunctionName: `${writeCollectionFunction.functionName}:$LATEST`,
        cloudFrontDistributionId: distribution.distributionId,
      },
      stateMachineName: "manifestEditPublish",
    };

    const stepFunction = new stepfunctions.CfnStateMachine(
      this,
      "manifestEditPublish",
      cfnStateMachineProps
    );

    // publish collection and manifests
    const publishResource = api.root.addResource("publish");

    const publishFunction = new lambda.Function(this, "publish", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambdas/publish")
      ),
      environment: {
        PUBLISH_STATE_MACHINE_ARN: stepFunction.attrArn,
      },
    });
    publishFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [stepFunction.attrArn],
      })
    );

    publishResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(publishFunction),
      {
        authorizer,
      }
    );
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
