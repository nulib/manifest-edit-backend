const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");

const PUBLIC_BASE_URL = process.env.BASE_URL;
const BUCKET = process.env.BUCKET;
const MANIFEST_TABLE_NAME = process.env.MANIFEST_TABLE_NAME;
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async function (event, context) {
  console.log(JSON.stringify(event))

  const jsonCollection = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    "id": `${PUBLIC_BASE_URL}/collection.json`,
    "type": "Collection",
    "label": {
      "none": [
        "This is the label"
      ]
    }
  }

  try{
    const items = await Promise.all(event.Items.map(async (item) => {
      const result = await axios.get(item.uri.S);
      const manifest = result.data;
      const storedLabel = await getLabel(item.uri.S);
      const label = storedLabel ? { "none": [storedLabel] } : manifest.label;
      return {"id": `${PUBLIC_BASE_URL}/${item.publishKey.S}.json`, "type": "Manifest", "label": label}
    }));
  
    jsonCollection.items = items;
    
    const s3Client = new S3Client();

    const params = {
      Bucket: BUCKET,
      Key: "collection.json",
      ContentType: "application/json",
      ACL: "private",
      Body: JSON.stringify(jsonCollection, null, 4)
    }
    const putObjectCommand = new PutObjectCommand(params);
    await s3Client.send(putObjectCommand);
    
    
  }catch(error){
    console.error(error)
  }
 
    const response = {
      statusCode: 200
    };
    return response;
  
};

/**
 * getLabel function to check get label for manifest
 */
async function getLabel(uri) {
  const params = {
    TableName: MANIFEST_TABLE_NAME,
    Key: {
      uri: uri,
      sortKey: `METADATA`,
    },
  };

  try {
    const data = await docClient.send(new GetCommand(params));
    if (data?.Item) {
      return data.Item.label
    }else{
      return null;
    }
  } catch (error) {
    console.error("Error fetching metadata from DynamoDB: ", error);
    return null;
  }
}
