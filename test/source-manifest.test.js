const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isManifest,
  localizeSourceManifest,
  normalizePublishedDerivative,
  sourceManifestKey,
  sourceManifestUri,
} = require("../lambdas/writeManifest/source-manifest");

test("uses the persisted publish key for the cached source path", () => {
  assert.equal(
    sourceManifestKey("7536339d-ab36-4079-a206-2d46f78053dc"),
    "sources/7536339d-ab36-4079-a206-2d46f78053dc.json"
  );
});

test("builds the public URI for a cached source manifest", () => {
  assert.equal(
    sourceManifestUri(
      "https://iiif-maktaba.example.org/",
      "7536339d-ab36-4079-a206-2d46f78053dc"
    ),
    "https://iiif-maktaba.example.org/sources/7536339d-ab36-4079-a206-2d46f78053dc.json"
  );
});

test("recognizes Presentation 2 and Presentation 3 manifests", () => {
  assert.equal(isManifest({ type: "Manifest" }), true);
  assert.equal(isManifest({ "@type": "sc:Manifest" }), true);
  assert.equal(isManifest({ type: "Collection" }), false);
});

test("gives a cached Presentation 3 manifest its local identity", () => {
  const source = {
    id: "https://provider.example/manifest",
    type: "Manifest",
    items: [],
  };
  const uri = "https://maktaba.example/sources/publish-key.json";
  const localized = localizeSourceManifest(source, uri);

  assert.equal(localized.id, uri);
  assert.equal(source.id, "https://provider.example/manifest");
});

test("gives a cached Presentation 2 manifest its local identity", () => {
  const source = {
    "@id": "https://provider.example/manifest",
    "@type": "sc:Manifest",
    sequences: [],
  };
  const uri = "https://maktaba.example/sources/publish-key.json";
  const localized = localizeSourceManifest(source, uri);

  assert.equal(localized["@id"], uri);
  assert.equal(source["@id"], "https://provider.example/manifest");
});

test("normalizes a published derivative without changing provider image services", () => {
  const sourceUri = "https://provider.example/item/1/manifest";
  const imageService = "https://images.provider.example/iiif/2/image-1";
  const derivative = {
    id: "https://maktaba.example/publish-key.json",
    type: "Manifest",
    seeAlso: [
      {
        id: "https://provider.example/item/1.json",
        type: "Dataset",
      },
      {
        id: sourceUri,
        type: "Manifest",
        label: { none: ["Originating IIIF Manifest"] },
      },
    ],
    items: [
      {
        id: "https://maktaba.example/publish-key/canvas/0",
        type: "Canvas",
        items: [
          {
            id: "https://maktaba.example/publish-key/canvas/0/page",
            type: "AnnotationPage",
            items: [
              {
                id: "https://maktaba.example/publish-key/canvas/0/annotation/0",
                type: "Annotation",
                motivation: "painting",
                body: {
                  id: `${imageService}/full/full/0/default.jpg`,
                  type: "Image",
                  service: [{ "@id": imageService, "@type": "ImageService2" }],
                },
              },
            ],
          },
        ],
        annotations: [
          {
            id: "https://maktaba.example/publish-key/canvas/0/annotations",
            type: "AnnotationPage",
            items: [{ body: { type: "TextualBody", value: "old text" } }],
          },
        ],
      },
    ],
  };

  const normalized = normalizePublishedDerivative(derivative, sourceUri);

  assert.equal(normalized.id, sourceUri);
  assert.equal(normalized.seeAlso.length, 1);
  assert.equal(normalized.seeAlso[0].type, "Dataset");
  assert.equal(normalized.items[0].annotations, undefined);
  assert.equal(
    normalized.items[0].items[0].items[0].body.service[0]["@id"],
    imageService
  );
  assert.notEqual(normalized, derivative);
  assert.equal(derivative.items[0].annotations.length, 1);
});
