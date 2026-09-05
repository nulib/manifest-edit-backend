function alternateImageApiId(resourceId) {
  if (resourceId.includes("/iiif/3/")) {
    return resourceId.replace("/iiif/3/", "/iiif/2/");
  }

  if (resourceId.includes("/iiif/2/")) {
    return resourceId.replace("/iiif/2/", "/iiif/3/");
  }
}

function sortKeyCandidates(sortKey) {
  const separator = sortKey.indexOf("#");
  if (separator === -1) return [sortKey];

  const prefix = sortKey.slice(0, separator);
  const resourceId = sortKey.slice(separator + 1);

  if (!["CANVAS", "NOTE", "TRANSCRIPTION", "TRANSLATION"].includes(prefix)) {
    return [sortKey];
  }

  const alternate = alternateImageApiId(resourceId);
  return [...new Set([resourceId, alternate].filter(Boolean))].map(
    (candidate) => `${prefix}#${candidate}`
  );
}

module.exports = { sortKeyCandidates };
