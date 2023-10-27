const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

exports.handler = async function (event, context) {
  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  const command = new GetCommand({
    TableName: process.env.MANIFESTS_TABLE,
    Key: {
      id: "cd9a66f9-b10b-4b7c-b0dc-746b138dd941",
    },
  });

  const response = await docClient.send(command);

  console.log("EVENT: \n" + JSON.stringify(event, null, 2));
  return {
    headers: {
      "content-type": "application/json",
    },
    statusCode: 200,
    body: JSON.stringify(response.Item),
  };
};
