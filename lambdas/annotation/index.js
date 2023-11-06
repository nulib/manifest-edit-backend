const { DynamoDBClient, DeleteItemCommand, PutItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");


exports.handler = async function (event, _context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));
  const method = event.httpMethod;

  try {
    const requestBody = JSON.parse(event.body);
    const client = new DynamoDBClient({});

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



