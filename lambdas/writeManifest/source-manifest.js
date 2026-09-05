const SOURCE_MANIFEST_PREFIX = "sources";

function sourceManifestKey(publishKey) {
  if (typeof publishKey !== "string" || publishKey.length === 0) {
    throw new Error("A publish key is required for the cached source manifest");
  }

  return `${SOURCE_MANIFEST_PREFIX}/${publishKey}.json`;
}

function sourceManifestUri(baseUrl, publishKey) {
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error("A base URL is required for the cached source manifest");
  }

  return `${baseUrl.replace(/\/+$/, "")}/${sourceManifestKey(publishKey)}`;
}

function isManifest(manifest) {
  return Boolean(
    manifest &&
      typeof manifest === "object" &&
      (manifest.type === "Manifest" || manifest["@type"] === "sc:Manifest")
  );
}

function localizeSourceManifest(manifest, uri) {
  if (!isManifest(manifest)) {
    throw new Error("The cached source is not a IIIF Manifest");
  }
  if (typeof uri !== "string" || uri.length === 0) {
    throw new Error("A local URI is required for the cached source manifest");
  }

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

function isOriginatingManifestReference(reference, sourceUri) {
  if (!reference || reference.id !== sourceUri) return false;

  const labels = reference?.label?.none;
  return (
    reference.type === "Manifest" &&
    Array.isArray(labels) &&
    labels.includes("Originating IIIF Manifest")
  );
}

/**
 * Existing UIUC source manifests can no longer be fetched by a non-browser
 * client. This converts a Maktaba-published derivative into a clean build
 * input by restoring the provider manifest id and removing Maktaba's local
 * text annotation pages. Provider image and Image API service ids are left
 * unchanged.
 */
function normalizePublishedDerivative(manifest, sourceUri) {
  if (!isManifest(manifest)) {
    throw new Error("The published derivative is not a IIIF Manifest");
  }

  const normalized = JSON.parse(JSON.stringify(manifest));
  normalized.id = sourceUri;

  if (Array.isArray(normalized.seeAlso)) {
    normalized.seeAlso = normalized.seeAlso.filter(
      (reference) => !isOriginatingManifestReference(reference, sourceUri)
    );
  }

  if (Array.isArray(normalized.items)) {
    normalized.items = normalized.items.map((canvas) => {
      const cleanCanvas = { ...canvas };
      delete cleanCanvas.annotations;
      return cleanCanvas;
    });
  }

  return normalized;
}

module.exports = {
  isManifest,
  localizeSourceManifest,
  normalizePublishedDerivative,
  sourceManifestKey,
  sourceManifestUri,
};
