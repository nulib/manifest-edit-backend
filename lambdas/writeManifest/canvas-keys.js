function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function resourceIdFromCanvas(canvas) {
  const annotationPage = canvas?.items?.[0];
  const paintingAnnotation = annotationPage?.items?.[0];
  const annotationBody = asArray(paintingAnnotation?.body)[0];
  const body = annotationBody?.type === "Choice"
    ? asArray(annotationBody.items)[0]
    : annotationBody;
  const service = asArray(body?.service)[0];
  const resourceId = service?.id || service?.["@id"] || body?.id || body?.["@id"];

  if (!resourceId) {
    throw new Error(`Unable to determine an image resource ID for canvas ${canvas?.id || canvas?.["@id"] || "unknown"}`);
  }

  return resourceId;
}

function alternateImageApiId(resourceId) {
  if (resourceId.includes("/iiif/3/")) {
    return resourceId.replace("/iiif/3/", "/iiif/2/");
  }

  if (resourceId.includes("/iiif/2/")) {
    return resourceId.replace("/iiif/2/", "/iiif/3/");
  }
}

function resourceIdCandidates(resourceIdOrCanvas) {
  const resourceId = typeof resourceIdOrCanvas === "string"
    ? resourceIdOrCanvas
    : resourceIdFromCanvas(resourceIdOrCanvas);
  const alternate = alternateImageApiId(resourceId);

  return [...new Set([resourceId, alternate].filter(Boolean))];
}

function sortKeyCandidates(sortKey) {
  const separator = sortKey.indexOf("#");
  if (separator === -1) return [sortKey];

  const prefix = sortKey.slice(0, separator);
  const resourceId = sortKey.slice(separator + 1);

  if (!["CANVAS", "NOTE", "TRANSCRIPTION", "TRANSLATION"].includes(prefix)) {
    return [sortKey];
  }

  return resourceIdCandidates(resourceId).map((candidate) => `${prefix}#${candidate}`);
}

module.exports = {
  resourceIdCandidates,
  resourceIdFromCanvas,
  sortKeyCandidates,
};
