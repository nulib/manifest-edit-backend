const { DynamoDBClient, DeleteItemCommand, PutItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { DeleteObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { marshall } = require("@aws-sdk/util-dynamodb");
const { v4: uuidv4 } = require('uuid');


exports.handler = async function (event, _context) {
  const method = event.httpMethod;
  const headers = event.headers;
  console.log(JSON.stringify({ method, path: event.path }));
  if (event.body === null || event.body === undefined || event.body === "") {
    return respond(400, "Invalid JSON in body parameters")
  } 

  try {
    const requestBody = JSON.parse(event.body);
    const client = new DynamoDBClient({});

    if (!validParams(requestBody, method)) {
      return respond(400, "Invalid request paramters")
    } else if (!validContentType(method, headers)) {
      return respond(415, `Unsupported content type`);
    }

    // Add - will fail if uri/sortKey exists
    if (method === "POST") {
      const { sourceManifest, ...metadata } = requestBody;
      const publishKey = uuidv4();
      const sourceKey = sourceManifestKey(publishKey);
      const cachedManifest = localizeSourceManifest(
        sourceManifest,
        sourceManifestUri(publishKey)
      );

      await putSourceManifest(sourceKey, cachedManifest);

      const input = {
        "TableName": process.env.MANIFESTS_TABLE,
        "Item": marshall({
          ...metadata,
          publishKey
        }),
        ConditionExpression: "attribute_not_exists(#uri) AND attribute_not_exists(#sortKey)",
        ExpressionAttributeNames: {
          "#uri": "uri",
          "#sortKey": "sortKey"
        }
      }

      console.log(input)


      try {
        const command = new PutItemCommand(input);
        const response = await client.send(command);
        console.log("response", response);
      } catch (error) {
        await deleteSourceManifest(sourceKey);
        throw error;
      }

      return respond(200, JSON.stringify({ ...metadata, publishKey }));
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
          "#summary": "summary",
          "#provider": "provider",
          "#publicStatus": "publicStatus"
        },
        "ExpressionAttributeValues": {
          ":uri": { "S": requestBody.uri },
          ":sortKey": { "S": requestBody.sortKey },
          ":label": { "S": requestBody.label },
          ":summary": { "S": requestBody.summary || "" },
          ":provider": { "S": requestBody.provider },
          ":publicStatus": { "BOOL": requestBody.publicStatus },
        },
        "UpdateExpression": "SET #label = :label, #provider = :provider, #publicStatus = :publicStatus, #summary = :summary",
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

const validContentType = (method, headers) => {
  if (method === "POST" || method === "PUT") {
    if (headers === null || !headers.hasOwnProperty("content-type") || headers["content-type"] != "application/json") {
      return false;
    }
  }
  return true;
}

const validParams = (requestObject, method) => {
  if (method === "DELETE") {
    if (requestObject.uri && requestObject.sortKey) return true;
  }

  if (!requestObject.uri || !requestObject.sortKey || requestObject.sortKey !== "METADATA") return false;
  if (!requestObject.label || !(typeof requestObject.label === 'string' || requestObject.label instanceof String)) return false;
  if (requestObject.hasOwnProperty("summary") && !(typeof requestObject.summary === 'string' || requestObject.summary instanceof String)) return false;
  if (!requestObject.provider || !(requestObject.provider === "Northwestern" || requestObject.provider === "UIUC")) return false;
  if (!requestObject.hasOwnProperty("publicStatus") || typeof requestObject.publicStatus !== 'boolean') return false;
  if (method === "POST" && !isManifest(requestObject.sourceManifest)) return false;
  return true;
}

const isManifest = (manifest) => Boolean(
  manifest &&
  typeof manifest === "object" &&
  (manifest.type === "Manifest" || manifest["@type"] === "sc:Manifest")
)

const sourceManifestKey = (publishKey) => `sources/${publishKey}.json`;

const sourceManifestUri = (publishKey) => {
  if (!process.env.BASE_URL) {
    throw new Error("BASE_URL is required for the cached source manifest");
  }

  return `${process.env.BASE_URL.replace(/\/+$/, "")}/${sourceManifestKey(
    publishKey
  )}`;
}

const localizeSourceManifest = (manifest, uri) => {
  const localized = JSON.parse(JSON.stringify(manifest));
  if (localized.type === "Manifest" || Object.hasOwn(localized, "id")) {
    localized.id = uri;
  }
  if (
    localized["@type"] === "sc:Manifest" ||
    Object.hasOwn(localized, "@id")
  ) {
    localized["@id"] = uri;
  }
  return localized;
}

const putSourceManifest = async (key, manifest) => {
  const client = new S3Client({});
  await client.send(new PutObjectCommand({
    Bucket: process.env.BUCKET,
    Key: key,
    ContentType: "application/json",
    Body: JSON.stringify(manifest, null, 2),
  }));
}

const deleteSourceManifest = async (key) => {
  const client = new S3Client({});
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.BUCKET,
      Key: key,
    }));
  } catch (error) {
    console.error(`Unable to clean up cached source ${key}`, error);
  }
}
