const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { convertPresentation2 } = require("@iiif/parser/presentation-2");
const {
  resourceIdCandidates,
  resourceIdFromCanvas,
} = require("./canvas-keys");
const {
  attachTextAnnotations,
  rewriteCanvas,
  textAnnotation,
} = require("./manifest-transform");
const { isManifest, sourceManifestKey } = require("./source-manifest");

const BUCKET = process.env.BUCKET;
const BASE_URL = process.env.BASE_URL;
const MANIFEST_TABLE_NAME = process.env.MANIFEST_TABLE_NAME;
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({});

exports.handler = async function (event, context) {
  console.log(event)
  try {
    const key = event.publishKey.S;
    const data = await getSourceManifest(key);

    /**
     * upgrades manifest to IIIF Presentation 3.0 API
     */
    const manifestJson = convertPresentation2(data);

    /**
     * constuct unique key patterns
     */
    const id = `${BASE_URL}/${key}`;

    /**
     * stitch together new Manifest
     */
    const manifest = {
      ...manifestJson,
      id: `${id}.json`,
      seeAlso: [
        ...(Array.isArray(manifestJson?.seeAlso)
          ? manifestJson.seeAlso
          : manifestJson?.seeAlso
            ? [manifestJson.seeAlso]
            : []),
        {
          id: event.uri.S,
          type: "Manifest",
          format: "application/json",
          label: {
            none: ["Originating IIIF Manifest"],
          },
        },
      ],
    };
    /**
    * Get label and summary from database
    */
    const metadata = await getLabelAndSummary(event.uri.S);
    if (metadata) {
      metadata.label && (manifest.label = { "none": [metadata.label] });
      metadata.summary && (manifest.summary = { "none": [metadata.summary] });
    }


    /**
     * Walk through Canvases and filter hidden ones
     */
    const visibleCanvases = await Promise.all(
      manifest.items.map(async (item) => {
        const resourceIds = resourceIdCandidates(item);
        const hide = await hideCanvas(event.uri.S, resourceIds);
        return hide ? null : item;
      })
    );

    // Filter out null values (hidden canvases)
    const filteredCanvases = visibleCanvases.filter((item) => item !== null);

    manifest.items = await Promise.all(
      filteredCanvases.map(async (item, index) => {
        /**
         * tidy ids and create new Canvas
         */
        const canvasId = `${id}/canvas/${index}`;
        const canvas = rewriteCanvas(item, canvasId);

        /**
         * annotate Canvas
         */
        const serviceId = resourceIdFromCanvas(item);
        const annotations = await getAnnotations(
          event.uri.S,
          resourceIdCandidates(serviceId),
          canvasId
        );

        return attachTextAnnotations(canvas, annotations);
      })
    );

    await saveDocumentToS3(key, manifest);
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  return {
    statusCode: 200,
    body: JSON.stringify("TODO"),
  };
};

/**
 * hideCanvas function to check if a canvas should be hidden
 */
async function hideCanvas(uri, resourceIds) {
  try {
    for (const resourceId of resourceIds) {
      const data = await getItem(uri, `CANVAS#${resourceId}`);
      if (data?.Item) {
        return data.Item.hide === true;
      }
    }
    return false;
  } catch (error) {
    console.error("Error fetching item from DynamoDB: ", error);
    throw error;
  }
}

/**
 * getLabelAndSummary function to check get label and summary for manifest
 */
async function getLabelAndSummary(uri) {
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
      return {
        label: data.Item.label || null,
        summary: data.Item.summary || null,
      }
    }
    return null;
  } catch (error) {
    console.error("Error fetching metadata from DynamoDB: ", error);
    throw error;
  }
}

async function getAnnotations(uri, resourceIds, canvasId) {
  const items = [
    {
      language: "en",
      sortKey: "TRANSLATION",
    },
    {
      language: "ar",
      sortKey: "TRANSCRIPTION",
    },
  ];

  const annotations = await Promise.all(
    items.map(async (entry) => {
      const data = await getFirstItem(
        uri,
        resourceIds.map((resourceId) => `${entry.sortKey}#${resourceId}`)
      );

      if (!data?.Item?.value) return;

      return textAnnotation({
        canvasId,
        language: entry.language,
        sortKey: entry.sortKey,
        value: data.Item.value,
      });
    })
  );

  return annotations.filter((annotation) => annotation);
}

async function getItem(uri, sortKey) {
  return await docClient.send(new GetCommand({
    TableName: MANIFEST_TABLE_NAME,
    Key: { uri, sortKey },
  }));
}

async function getFirstItem(uri, sortKeys) {
  for (const sortKey of sortKeys) {
    const data = await getItem(uri, sortKey);
    if (data?.Item) return data;
  }

  return {};
}

async function getSourceManifest(publishKey) {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: sourceManifestKey(publishKey),
    })
  );
  const body = await response.Body.transformToString();
  const manifest = JSON.parse(body);

  if (!isManifest(manifest)) {
    throw new Error(
      `Cached source ${sourceManifestKey(publishKey)} is not a IIIF Manifest`
    );
  }

  return manifest;
}

async function saveDocumentToS3(key, doc) {
  const params = {
    Bucket: BUCKET,
    ContentType: "application/json",
    ContentEncoding: "base64",
    Key: `${key}.json`,
    ACL: "private",
    Body: JSON.stringify(doc, null, 4),
  };
  const putObjectCommand = new PutObjectCommand(params);
  return await s3Client.send(putObjectCommand);
}
