exports.handler = async function (event, context) {
  console.log("EVENT: \n" + JSON.stringify(event, null, 2));
  return {
    headers: {
      "content-type": "application/json"
    },
    statusCode: 200,
    body: JSON.stringify({id: "idgoeshere"})
  }
};