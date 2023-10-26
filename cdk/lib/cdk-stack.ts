import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamoDB from 'aws-cdk-lib/aws-dynamodb';

import { Construct } from 'constructs';

export class ManifestEditorBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'ManifestEditorUsers', {
      selfSignUpEnabled: false,
      mfa: cognito.Mfa.OFF,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const manifestsTable = new dynamoDB.Table(this, 'Manifests', {
      partitionKey: {
        name: 'id',
        type: dynamoDB.AttributeType.STRING,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
  }
}
