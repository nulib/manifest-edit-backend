import * as cdk from 'aws-cdk-lib';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamoDB from 'aws-cdk-lib/aws-dynamodb';

import { Construct } from 'constructs';

export class ManifestEditorBackendStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.tags.setTag("Project", "maktaba");

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CdkQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    const manifestsTable = new dynamoDB.Table(this, 'ManifestTable', {
      partitionKey: {
        name: 'id',
        type: dynamoDB.AttributeType.STRING,
      },
    })
  }
}
