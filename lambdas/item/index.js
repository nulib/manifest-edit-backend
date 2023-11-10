const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

exports.handler = async function (event, context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  if(!event.body || event.body === ""){
    return respond(400, "Missing required boy parameters")
  }
  const requestBody = JSON.parse(event.body)
  const uri = requestBody?.uri
  const sortKey = requestBody?.sortKey
  
  if(!uri || !sortKey){
    return respond(400, "Missing required parameters uri and sortKey")
  }
  
  const command = new GetCommand({
    TableName: process.env.MANIFESTS_TABLE,
    Key: {
      uri: uri,
      sortKey: sortKey
    },
  });

  try{
    const response = await docClient.send(command);
    console.log("response", response)
  
    if(response.Item === undefined){
      return respond(200, {})
    }
    return respond(200, JSON.stringify(response.Item));
  } catch (error) {
    return respond(500, "Internal Server Error")
  }
};

const respond = (statusCode, body) => {
  return {
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true
      
    },
    statusCode: statusCode,
    body: JSON.stringify({ body })
  }
}
