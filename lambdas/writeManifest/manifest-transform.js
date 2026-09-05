function rewriteCanvas(canvas, canvasId) {
  const paintingPage = canvas?.items?.[0];
  const paintingAnnotation = paintingPage?.items?.[0];

  if (!paintingPage || !paintingAnnotation) {
    throw new Error(`Canvas ${canvas?.id || "unknown"} has no painting annotation`);
  }

  return {
    ...canvas,
    id: canvasId,
    items: [
      {
        ...paintingPage,
        id: `${canvasId}/page`,
        items: paintingPage.items.map((annotation, index) => ({
          ...annotation,
          id: `${canvasId}/annotation/${index}`,
          target: canvasId,
        })),
      },
      ...canvas.items.slice(1),
    ],
  };
}

function textAnnotation({ canvasId, language, sortKey, value }) {
  return {
    id: `${canvasId}/annotations/${sortKey.toLowerCase()}`,
    type: "Annotation",
    motivation: "supplementing",
    body: {
      type: "TextualBody",
      language,
      format: "text/markdown",
      value,
    },
    target: canvasId,
  };
}

function attachTextAnnotations(canvas, annotations) {
  if (annotations.length === 0) return canvas;

  return {
    ...canvas,
    annotations: [
      {
        id: `${canvas.id}/annotations`,
        type: "AnnotationPage",
        items: annotations,
      },
    ],
  };
}

module.exports = { attachTextAnnotations, rewriteCanvas, textAnnotation };
