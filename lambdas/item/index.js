const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

exports.handler = async function (event, context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);
  const method = event.httpMethod;
  const headers = event.headers;

  if (!event.body || event.body === "") {
    return respond(400, "Missing required body parameters")
  } else if (!validContentType(method, headers)) {
    return respond(415, `Unsupported content type`);
  }
  const requestBody = JSON.parse(event.body)
  const uri = requestBody?.uri
  const sortKey = requestBody?.sortKey

  if (!uri || !sortKey) {
    return respond(400, "Missing required parameters uri and sortKey")
  }

  const command = new GetCommand({
    TableName: process.env.MANIFESTS_TABLE,
    Key: {
      uri: uri,
      sortKey: sortKey.replace("library.northwestern.edu/iiif/3", "library.northwestern.edu/iiif/2")
    },
  });

  try {
    const response = await docClient.send(command);
    console.log("response", response)

    if (response.Item === undefined) {
      return respond(404, "Not found")
    }
    return respond(200, JSON.stringify(response.Item));
  } catch (error) {
    return respond(500, "Internal Server Error")
  }
};

const validContentType = (method, headers) => {
  if (method === "POST" || method === "PUT") {
    if (headers === null || !headers.hasOwnProperty("content-type") || headers["content-type"] != "application/json") {
      return false;
    }
  }
  return true;
}

const respond = (statusCode, body) => {
  return {
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true

    },
    statusCode: statusCode,
    body: statusCode === 200 ? body : `{message: ${body}}`
  }
}