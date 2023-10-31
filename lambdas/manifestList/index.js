const { DynamoDBClient, QueryCommand } = require("@aws-sdk/client-dynamodb");

exports.handler = async function (event, context) {
  const client = new DynamoDBClient({});

  const command = new QueryCommand({
    KeyConditionExpression: "sortKey = :value",
    ExpressionAttributeValues: {
      ":value": { S: "METADATA" },
    },
    TableName: process.env.MANIFESTS_TABLE,
  });

  console.log("EVENT: \n" + JSON.stringify(event, null, 2));

  const response = await client.send(command);

  console.log(response);

  return {
    headers: {
      "content-type": "application/json",
    },
    statusCode: 200,
    body: JSON.stringify(response),
  };
};
