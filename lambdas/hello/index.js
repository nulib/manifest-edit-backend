const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const axios = require("axios");

exports.handler = async function (event, context) {
  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  const command = new GetCommand({
    TableName: process.env.MANIFESTS_TABLE,
    Key: {
      uri: "https://api.dc.library.northwestern.edu/api/v2/works/02c4ee9d-d34c-456e-82cf-6e197eac2b87?as=iiif",
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
