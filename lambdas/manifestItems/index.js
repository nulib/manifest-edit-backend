const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");


exports.handler = async function (event, _context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));
  const method = event.httpMethod;
  const requestBody = JSON.parse(event.body);
  const client = new DynamoDBClient({});
  
  if(requestBody == "" || !validParams(requestBody)){
    return respond(400, "Invalid request paramters")
  }
  
  // Add - will fail if uri/sortKey exists
  if(method === "POST"){
    const input = {
      "TableName": process.env.MANIFESTS_TABLE,
      "Item":  marshall({
        ...requestBody
      }),
      ConditionExpression: "#uri <> :uri AND #sortKey <>  :sortKey",
      ExpressionAttributeNames: { 
        "#uri": "uri",
        "#sortKey" : "sortKey" 
      },
      ExpressionAttributeValues: {
        ":uri" : {"S": requestBody.uri},
        ":sortKey": {"S": requestBody.sortKey}
      }
    }
    
    console.log(input)
    
    try{
      const command = new PutItemCommand(input);
      const response = await client.send(command);
      console.log("response", response);
      return respond(200, JSON.stringify(requestBody));
    }catch(err){
      console.error(JSON.stringify(err));
      return respond(500, `Error - Unable to add item: ${err.name}`);
    }
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
    body: body
  }
}

const validParams = (requestObject) => {
  if(!requestObject.sortKey || requestObject.sortKey !== "METADATA") return false;
  if(!requestObject.label || !(typeof requestObject.label === 'string' || requestObject.label instanceof String)) return false;
  if(!requestObject.provider || !(requestObject.provider === "Northwestern" || requestObject.provider === "UIUC")) return false;
  if(!requestObject.hasOwnProperty("public") || typeof requestObject.public !== 'boolean') return false;
  return true;
}



