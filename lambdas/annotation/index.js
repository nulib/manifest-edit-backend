const { DynamoDBClient, DeleteItemCommand, PutItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");


exports.handler = async function (event, _context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));
  const method = event.httpMethod;
  const headers = event.headers;

  try {
    const requestBody = JSON.parse(event.body);
    const client = new DynamoDBClient({});

    if (!validContentType(method, headers)) {
      return respond(415, `Unsupported content type`);
    }

    // Add - will fail if uri/sortKey exists
    if (method === "POST") {
      const input = {
        "TableName": process.env.MANIFESTS_TABLE,
        "Item": marshall({
          ...requestBody
        }),
        ConditionExpression: "#uri <> :uri AND #sortKey <>  :sortKey",
        ExpressionAttributeNames: {
          "#uri": "uri",
          "#sortKey": "sortKey"
        },
        ExpressionAttributeValues: {
          ":uri": { "S": requestBody.uri },
          ":sortKey": { "S": requestBody.sortKey }
        }
      }

      console.log(input)


      const command = new PutItemCommand(input);
      const response = await client.send(command);
      console.log("response", response);
      return respond(200, JSON.stringify(requestBody));
    }

    // Update - will fail if uri/sortKey does not exist
    if (method === "PUT") {
      const input = {
        "Key": {
          "uri": { "S": requestBody.uri },
          "sortKey": { "S": requestBody.sortKey }
        },
        "TableName": process.env.MANIFESTS_TABLE,
        "ConditionExpression": "#uri = :uri AND #sortKey = :sortKey",
        "ExpressionAttributeNames": {
          "#uri": "uri",
          "#sortKey": "sortKey",
          "#value": "value"
        },
        "ExpressionAttributeValues": {
          ":uri": { "S": requestBody.uri },
          ":sortKey": { "S": requestBody.sortKey },
          ":value": { "S": requestBody.value }
        },
        "UpdateExpression": "SET #value = :value",
        "ReturnValue": "ALL_NEW"
      }

      console.log(input)

      const command = new UpdateItemCommand(input);
      const response = await client.send(command);
      console.log("response", response);
      return respond(200, JSON.stringify(requestBody));
    }

    // Delete
    if (method === "DELETE") {
      const input = {
        "Key": {
          "uri": { "S": requestBody.uri },
          "sortKey": { "S": requestBody.sortKey }
        },
        "TableName": process.env.MANIFESTS_TABLE,
      }
      const command = new DeleteItemCommand(input);
      const response = await client.send(command);
      console.log("response", response);
      return respond(200, JSON.stringify(requestBody));
    };

  } catch (err) {
    console.error(JSON.stringify(err));
    return respond(500, `Error - Unable to complete request: ${err.name}`);
  }
  return respond(500, "Unknown request");
}

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



