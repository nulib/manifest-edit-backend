const { DynamoDBClient, DeleteItemCommand, PutItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");
const { v4: uuidv4 } = require('uuid');


exports.handler = async function (event, _context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));
  const method = event.httpMethod;
  if (event.body === null || event.body === undefined || event.body === "") {
    return respond(400, "Invalid JSON in body parameters")
  }

  try {
    const requestBody = JSON.parse(event.body);
    const client = new DynamoDBClient({});

    if (!validParams(requestBody, method)) {
      return respond(400, "Invalid request paramters")
    }

    // Add - will fail if uri/sortKey exists
    if (method === "POST") {
      const input = {
        "TableName": process.env.MANIFESTS_TABLE,
        "Item": marshall({
          ...requestBody,
          publishKey: uuidv4()
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
          "#label": "label",
          "#provider": "provider",
          "#publicStatus": "publicStatus"
        },
        "ExpressionAttributeValues": {
          ":uri": { "S": requestBody.uri },
          ":sortKey": { "S": requestBody.sortKey },
          ":label": { "S": requestBody.label },
          ":provider": { "S": requestBody.provider },
          ":publicStatus": { "BOOL": requestBody.publicStatus },
        },
        "UpdateExpression": "SET #label = :label, #provider = :provider, #publicStatus = :publicStatus",
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

const validParams = (requestObject, method) => {
  if (method === "DELETE") {
    if (requestObject.uri && requestObject.sortKey) return true;
  }

  if (!requestObject.uri || !requestObject.sortKey || requestObject.sortKey !== "METADATA") return false;
  if (!requestObject.label || !(typeof requestObject.label === 'string' || requestObject.label instanceof String)) return false;
  if (!requestObject.provider || !(requestObject.provider === "Northwestern" || requestObject.provider === "UIUC")) return false;
  if (!requestObject.hasOwnProperty("publicStatus") || typeof requestObject.publicStatus !== 'boolean') return false;
  return true;
}



