import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";

import { Construct } from "constructs";

export class PublishCollectionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const bucket = new s3.Bucket(this, "assetsBucket", {
      bucketName: "manifest-edit-public-assets",
      accessControl: s3.BucketAccessControl.PRIVATE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

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
  }
}
