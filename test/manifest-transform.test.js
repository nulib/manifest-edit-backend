const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attachTextAnnotations,
  rewriteCanvas,
  textAnnotation,
} = require("../lambdas/writeManifest/manifest-transform");

const sourceCanvas = {
  id: "https://provider.example/canvas/1",
  type: "Canvas",
  items: [
    {
      id: "https://provider.example/page/1",
      type: "AnnotationPage",
      items: [
        {
          id: "https://provider.example/painting/1",
          type: "Annotation",
          motivation: "painting",
          target: "https://provider.example/canvas/1",
          body: { id: "https://images.example/image.jpg", type: "Image" },
        },
      ],
    },
  ],
};

test("rewrites a painting annotation to target its derived canvas", () => {
  const canvasId = "https://maktaba.example/manifest/canvas/0";
  const canvas = rewriteCanvas(sourceCanvas, canvasId);

  assert.equal(canvas.id, canvasId);
  assert.equal(canvas.items[0].id, `${canvasId}/page`);
  assert.equal(canvas.items[0].items[0].id, `${canvasId}/annotation/0`);
  assert.equal(canvas.items[0].items[0].target, canvasId);
  assert.equal(sourceCanvas.items[0].items[0].target, sourceCanvas.id);
});

test("rewrites every painting annotation on the first page", () => {
  const secondPainting = {
    ...sourceCanvas.items[0].items[0],
    id: "https://provider.example/painting/2",
  };
  const source = {
    ...sourceCanvas,
    items: [
      {
        ...sourceCanvas.items[0],
        items: [sourceCanvas.items[0].items[0], secondPainting],
      },
    ],
  };
  const canvasId = "https://maktaba.example/manifest/canvas/0";
  const canvas = rewriteCanvas(source, canvasId);

  assert.deepEqual(
    canvas.items[0].items.map(({ id, target }) => ({ id, target })),
    [
      { id: `${canvasId}/annotation/0`, target: canvasId },
      { id: `${canvasId}/annotation/1`, target: canvasId },
    ]
  );
});

test("attaches supplementing text annotations to the containing canvas", () => {
  const canvasId = "https://maktaba.example/manifest/canvas/0";
  const canvas = rewriteCanvas(sourceCanvas, canvasId);
  const annotations = [
    textAnnotation({
      canvasId,
      language: "en",
      sortKey: "TRANSLATION",
      value: "Translated text",
    }),
    textAnnotation({
      canvasId,
      language: "ar",
      sortKey: "TRANSCRIPTION",
      value: "نص",
    }),
  ];
  const annotatedCanvas = attachTextAnnotations(canvas, annotations);

  assert.equal(annotatedCanvas.annotations[0].id, `${canvasId}/annotations`);
  assert.deepEqual(
    annotatedCanvas.annotations[0].items.map(({ motivation, target }) => ({
      motivation,
      target,
    })),
    [
      { motivation: "supplementing", target: canvasId },
      { motivation: "supplementing", target: canvasId },
    ]
  );
});

test("does not add an empty annotation page", () => {
  const canvas = rewriteCanvas(sourceCanvas, "https://maktaba.example/manifest/canvas/0");
  assert.equal(attachTextAnnotations(canvas, []), canvas);
});
