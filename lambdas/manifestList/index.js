const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");


exports.handler = async function (event, context) {
  const client = new DynamoDBClient({});

  const command = new ScanCommand({
    FilterExpression: "sortKey = :value",
    ExpressionAttributeValues: {
      ":value": { S: "METADATA" },
    },
    TableName: process.env.MANIFESTS_TABLE,
  });
  const response = await client.send(command);
  
  return response.Items.map((item) => unmarshall(item));
};
