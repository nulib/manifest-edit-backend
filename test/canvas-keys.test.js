const assert = require("node:assert/strict");
const test = require("node:test");

const itemKeys = require("../lambdas/item/canvas-keys");
const publisherKeys = require("../lambdas/writeManifest/canvas-keys");

const imageId = "https://iiif.dc.library.northwestern.edu/iiif/3/image-id";
const legacyImageId = "https://iiif.dc.library.northwestern.edu/iiif/2/image-id";

function canvasWithService(service) {
  return {
    id: "https://example.org/canvas/1",
    items: [{ items: [{ body: { id: `${imageId}/full/max/0/default.jpg`, service } }] }],
  };
}

test("uses an Image API 3 service id as the canonical resource id", () => {
  assert.equal(
    publisherKeys.resourceIdFromCanvas(canvasWithService([{ id: imageId }])),
    imageId
  );
});

test("uses an Image API 2 service @id as the canonical resource id", () => {
  assert.equal(
    publisherKeys.resourceIdFromCanvas(canvasWithService([{ "@id": legacyImageId }])),
    legacyImageId
  );
});

test("supports a single service object and falls back to the body id", () => {
  assert.equal(
    publisherKeys.resourceIdFromCanvas(canvasWithService({ id: imageId })),
    imageId
  );
  assert.equal(
    publisherKeys.resourceIdFromCanvas(canvasWithService(undefined)),
    `${imageId}/full/max/0/default.jpg`
  );
});

test("uses the first image in a Choice body", () => {
  const canvas = canvasWithService(undefined);
  canvas.items[0].items[0].body = {
    type: "Choice",
    items: [
      { service: [{ id: imageId }] },
      { service: [{ id: "https://example.org/alternate" }] },
    ],
  };

  assert.equal(publisherKeys.resourceIdFromCanvas(canvas), imageId);
});

test("fails explicitly when a canvas has no usable image identifier", () => {
  assert.throws(
    () => publisherKeys.resourceIdFromCanvas({ id: "canvas", items: [{ items: [{ body: {} }] }] }),
    /Unable to determine an image resource ID/
  );
});

test("prefers the current key and adds the alternate Image API version", () => {
  assert.deepEqual(publisherKeys.resourceIdCandidates(imageId), [imageId, legacyImageId]);
  assert.deepEqual(publisherKeys.resourceIdCandidates(legacyImageId), [legacyImageId, imageId]);
});

test("the item API and publisher generate identical compatibility keys", () => {
  for (const prefix of ["CANVAS", "NOTE", "TRANSCRIPTION", "TRANSLATION"]) {
    const sortKey = `${prefix}#${imageId}`;
    assert.deepEqual(itemKeys.sortKeyCandidates(sortKey), [
      sortKey,
      `${prefix}#${legacyImageId}`,
    ]);
    assert.deepEqual(itemKeys.sortKeyCandidates(sortKey), [
      `${prefix}#${publisherKeys.resourceIdCandidates(imageId)[0]}`,
      `${prefix}#${publisherKeys.resourceIdCandidates(imageId)[1]}`,
    ]);
  }
});

test("does not reinterpret metadata or corrupted undefined keys", () => {
  assert.deepEqual(itemKeys.sortKeyCandidates("METADATA"), ["METADATA"]);
  assert.deepEqual(itemKeys.sortKeyCandidates("TRANSLATION#undefined"), [
    "TRANSLATION#undefined",
  ]);
});
