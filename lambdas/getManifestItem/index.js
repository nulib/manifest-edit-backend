const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

exports.handler = async function (event, context) {
  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  const requestBody = JSON.parse(event.body)
  const uri = requestBody.uri
  const sortKey = requestBody.sortKey
  
  console.log("uri", uri);
  console.log("sortKey", sortKey);
  
  const command = new GetCommand({
    TableName: process.env.MANIFESTS_TABLE,
    Key: {
      uri: uri,
      sortKey: sortKey
    },
  });

  const response = await docClient.send(command);


  return {
    headers: {
      "content-type": "application/json",
    },
    statusCode: 200,
    body: JSON.stringify(response.Item),
  };
};