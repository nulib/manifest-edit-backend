import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as fs from 'fs'
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as path from "node:path";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

import { Construct } from "constructs";
import { aws_stepfunctions as stepfunctions } from 'aws-cdk-lib';

export class PublishCollectionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucketName = cdk.SecretValue.secretsManager("cdk/deploy-config", {
      jsonField: "manifestBucket",
    }).unsafeUnwrap().toString();
    const bucket = new s3.Bucket(this, "assetsBucket", {
      bucketName: bucketName,
      accessControl: s3.BucketAccessControl.PRIVATE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const manifestTableName = cdk.Fn.importValue('manifestsTableName');
    console.log("manifestTableName", manifestTableName);

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "CFOriginAccessIdentity"
    );
    bucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.Distribution(this, "CFDistribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, { originAccessIdentity }),
      },
    });

    const writeManifestFunction = new lambda.Function(this, "writeManifest", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: this.bundleAssets("../../lambdas/writeManifest"),
      environment: {
        BASE_URL: `https://${distribution.domainName}`,
        BUCKET: bucket.bucketName,
        MANIFEST_TABLE_NAME: manifestTableName
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
        actions: [
          "dynamodb:GetItem"
      ],
        resources: [`arn:aws:dynamodb:us-east-1:${this.account}:table/${manifestTableName}`]
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
          BASE_URL: `https://${distribution.domainName}`,
          BUCKET: bucket.bucketName,
          MANIFEST_TABLE_NAME: manifestTableName
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

    const publishStateMachineRole = new iam.Role(this, "manifestPublishStateMachine", {
      assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
      description: "Role for Manifest Editor Publish State Machine"
    })

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
          "dynamodb:BatchGetItem"
      ],
        resources: [`arn:aws:dynamodb:us-east-1:${this.account}:table/${manifestTableName}`]
      })
    );

    publishStateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets"
      ],
        resources: ["*"]
      })
    );



    const cfnStateMachineProps: stepfunctions.CfnStateMachineProps = {
      roleArn: publishStateMachineRole.roleArn,
      definitionString: fs.readFileSync("../state-machines/publish-definition.asl.json").toString(),
      definitionSubstitutions: {
        manifestTableName: `${manifestTableName}`,
        writeManifestFunctionName:`${writeManifestFunction.functionName}:$LATEST`,
        writeCollectionFunctionName:`${writeCollectionFunction.functionName}:$LATEST`,
        cloudFrontDistributionId: distribution.distributionId
      },
      stateMachineName: 'manifestEditPublish',
    }; 
  
    const stepFunction = new stepfunctions.CfnStateMachine(this, 'manifestEditPublish',
      cfnStateMachineProps
    )

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
