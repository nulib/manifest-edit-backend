const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");

const PUBLIC_BASE_URL = process.env.BASE_URL;
const BUCKET = process.env.BUCKET;

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
      return {"id": `${PUBLIC_BASE_URL}/${item.publishKey.S}.json`, "type": "Manifest", "label": manifest["label"]}
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
