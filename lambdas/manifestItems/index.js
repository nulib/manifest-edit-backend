
exports.handler = async function (event, _context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));
  const method = event.httpMethod;
  
  const requestBody = JSON.parse(event.body)
  
  if(!requestBody?.uri || !requestBody?.sortKey){
    return {
    headers: {
      "content-type": "application/json",
    },
    statusCode: 400,
    body: JSON.stringify({error: "Bad Request"})
    }
  }
  
  switch(method) {
    case "POST":
      break;
    case "PUT":
      break;
    case "DELETE":
      break;
    default:
  }
  

  return {
    headers: {
      "content-type": "application/json",
    },
    statusCode: 200,
    body: JSON.stringify({"hi": "hello"})
  };
};



