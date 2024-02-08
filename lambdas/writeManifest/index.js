const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");
const { convertPresentation2 } = require("@iiif/parser/presentation-2");

const BUCKET = process.env.BUCKET;
const BASE_URL = process.env.BASE_URL;
const MANIFEST_TABLE_NAME = process.env.MANIFEST_TABLE_NAME;
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async function (event, context) {
  try {
    /**
     * fetch IIIF manifest
     */
    const res = await axios.get(event.uri.S);
    const data = res?.data;

    /**
     * upgrades manifest to IIIF Presentation 3.0 API
     */
    const manifestJson = convertPresentation2(data);

    /**
     * constuct unique key patterns
     */
    const key = event.publishKey.S;
    const id = `${BASE_URL}/${key}`;

    /**
     * stitch together new Manifest
     */
    const manifest = {
      ...manifestJson,
      id: `${id}.json`,
      seeAlso: [
        ...manifestJson?.seeAlso,
        {
          id: manifestJson.id,
          type: "Manifest",
          format: "application/json",
          label: {
            none: ["Originating IIIF Manifest"],
          },
        },
      ],
    };

    /**
     * walk through Canvases
     */
    await Promise.all(
      manifest.items.map(async (item, index) => {
        /**
         * tidy ids and create new Canvas
         */
        const canvasId = `${id}/canvas/${index}`;
        const canvas = {
          ...item,
          id: canvasId,
        };

        canvas.items[0].id = `${canvasId}/page`;
        canvas.items[0].items[0].id = `${canvasId}/annotation/0`;
        canvas.items[0].items[0].target = canvasId;

        /**
         * annotate Canvas
         */
        const serviceId = item.items[0].items[0].body.service[0]["@id"];
        const annotations = await getAnnotations(
          event.uri.S,
          serviceId,
          canvasId
        );

        if (annotations.length > 0) {
          canvas.annotations = [
            {
              id: `${canvasId}/annotations`,
              type: "AnnotationPage",
              items: annotations,
            },
          ];
        }

        manifest.items[index] = canvas;
      })
    );

    await saveDocumentToS3(key, manifest);
  } catch (error) {
    console.error(JSON.stringify(error));
  }

  return {
    statusCode: 200,
    body: JSON.stringify("TODO"),
  };
};

async function getAnnotations(uri, serviceId, canvasId) {
  /**
   * note that "commenting" is the spec valid motivation value, however the newly formed
   * IIIF Annotations TSG is proposing "transcribing" and "translating" as valid options
   * let's use those once they are valid
   */
  const items = [
    {
      language: "ar",
      motivation: "commenting",
      sortKey: "TRANSCRIPTION",
    },
    {
      language: "en",
      motivation: "commenting",
      sortKey: "TRANSLATION",
    },
  ];

  const annotations = await Promise.all(
    items.map(async (entry) => {
      const command = new GetCommand({
        TableName: MANIFEST_TABLE_NAME,
        Key: {
          uri: uri,
          sortKey: `${entry.sortKey}#${serviceId}`,
        },
      });

      const data = await docClient.send(command);

      if (!data?.Item?.value) return;

      return await {
        id: `${canvasId}/annotations/${entry.sortKey.toLowerCase()}`,
        type: "Annotation",
        motivation: entry.motivation,
        body: {
          type: "TextualBody",
          language: entry.language,
          format: "text/plain",
          value: data.Item.value,
        },
        target: canvasId,
      };
    })
  );

  return annotations.filter((annotation) => annotation);
}

async function saveDocumentToS3(key, doc) {
  const s3Client = new S3Client();
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
