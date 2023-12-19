const { SFNClient, StartExecutionCommand } = require("@aws-sdk/client-sfn"); 
exports.handler = async function (_event, _context) {

  const client = new SFNClient();
  const input = {
    stateMachineArn: process.env.PUBLISH_STATE_MACHINE_ARN,
    input: "{}"
  };
  const command = new StartExecutionCommand(input);
  const response = await client.send(command);
  console.log(response);

  return {
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true
    },
    statusCode: 200,
    body: JSON.stringify({ "published": true })
  }

}