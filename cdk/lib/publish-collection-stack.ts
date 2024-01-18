import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as fs from 'fs'
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as path from "node:path";
import * as route53  from 'aws-cdk-lib/aws-route53';
import * as s3 from "aws-cdk-lib/aws-s3";

import { Construct } from "constructs";
import { aws_certificatemanager as acm } from 'aws-cdk-lib';
import { aws_stepfunctions as stepfunctions } from 'aws-cdk-lib';

interface  PublishCollectionStackProps extends cdk.StackProps {
  wildcardCertificateArn: string
  deployBranch: string
  publishStateMachineArn: string
  baseDomainName: string
  manifestBucket: string
  "github-token": string  
  "weaviate-host": string
  "weaviate-api-key": string
  "azure-openai-api-key": string
  "dcapi-endpoint": string
  "textract-bucket-arn": string
}

export class PublishCollectionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PublishCollectionStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "assetsBucket", {
      bucketName: props.manifestBucket,
      accessControl: s3.BucketAccessControl.PRIVATE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      versioned: true,
    });

    const manifestTableName = cdk.Fn.importValue('manifestsTableName');

    const hostedZone = route53.HostedZone.fromLookup(this, 'hostedZone', {
      domainName: props.baseDomainName,
    });

    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', props.wildcardCertificateArn);


    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "CFOriginAccessIdentity"
    );
    bucket.grantRead(originAccessIdentity);

    const iiifAssetsDomainName = `iiif-maktaba.${props.baseDomainName}`;

    const distribution = new cloudfront.Distribution(this, "CFDistribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, { originAccessIdentity }),
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      domainNames: [iiifAssetsDomainName],
      certificate: certificate,
    });

    const _aliasRecord = new route53.ARecord(this, 'CloudFrontDistAliasRecord', {
      target: route53.RecordTarget.fromAlias(new cdk.aws_route53_targets.CloudFrontTarget(distribution)),
      zone: hostedZone,
      recordName: iiifAssetsDomainName,
    });

    const writeManifestFunction = new lambda.Function(this, "writeManifest", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: this.bundleAssets("../../lambdas/writeManifest"),
      environment: {
        BASE_URL: `https://${iiifAssetsDomainName}`,
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
          BASE_URL: `https://${iiifAssetsDomainName}`,
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
