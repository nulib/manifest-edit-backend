import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager"; // ES Modules import

export const loadBuildConfig = async () => {
  const client = new SecretsManagerClient();
  const input = { 
    SecretId: "maktaba/deploy-config"
  };
  const command = new GetSecretValueCommand(input);
  const response = await client.send(command);
  const secret = response.SecretString;
  return secret;
};