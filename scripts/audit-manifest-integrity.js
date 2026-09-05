#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--profile") options.profile = argv[++index];
    else if (argument === "--table") options.table = argv[++index];
    else if (argument === "--published-base-url") options.publishedBaseUrl = argv[++index];
    else if (argument === "--source-cache-bucket") options.sourceCacheBucket = argv[++index];
    else if (argument === "--public-only") options.publicOnly = true;
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function usage() {
  console.log(`Usage:
  node scripts/audit-manifest-integrity.js --profile PROFILE --table TABLE [options]

Options:
  --published-base-url URL  Compare public records with their derived manifests
  --source-cache-bucket S3  Read build inputs from sources/<publishKey>.json
  --public-only             Skip private manifest records
  --strict                  Fail when unmatched or undefined persisted keys exist
  --help                    Show this help`);
}

function decodeItem(item) {
  return {
    hide: item.hide?.BOOL,
    provider: item.provider?.S,
    publicStatus: item.publicStatus?.BOOL,
    publishKey: item.publishKey?.S,
    sortKey: item.sortKey.S,
    uri: item.uri.S,
    value: item.value?.S,
  };
}

function scanTable(profile, table) {
  const names = JSON.stringify({
    "#h": "hide",
    "#p": "provider",
    "#pk": "publishKey",
    "#ps": "publicStatus",
    "#s": "sortKey",
    "#u": "uri",
    "#v": "value",
  });
  const output = execFileSync(
    "aws",
    [
      "dynamodb",
      "scan",
      "--profile",
      profile,
      "--region",
      "us-east-1",
      "--table-name",
      table,
      "--consistent-read",
      "--projection-expression",
      "#u,#s,#p,#ps,#pk,#h,#v",
      "--expression-attribute-names",
      names,
      "--output",
      "json",
    ],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
  );

  return JSON.parse(output).Items.map(decodeItem);
}

const asArray = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

function imageResourceId(body, canvasId) {
  const annotationBody = asArray(body)[0];
  const resource = annotationBody?.type === "Choice"
    ? asArray(annotationBody.items)[0]
    : annotationBody;
  const service = asArray(resource?.service)[0];
  const id = service?.id || service?.["@id"] || resource?.id || resource?.["@id"];

  if (!id) throw new Error(`No image resource ID for canvas ${canvasId}`);
  return id;
}

function sourceCanvases(manifest) {
  if (Array.isArray(manifest.items)) {
    return manifest.items.map((canvas) => ({
      id: canvas.id,
      resourceId: imageResourceId(canvas.items?.[0]?.items?.[0]?.body, canvas.id),
    }));
  }

  return asArray(manifest.sequences).flatMap((sequence) =>
    asArray(sequence.canvases).map((canvas) => ({
      id: canvas["@id"],
      resourceId: imageResourceId(canvas.images?.[0]?.resource, canvas["@id"]),
    }))
  );
}

function resourceIdCandidates(resourceId) {
  let alternate;
  if (resourceId.includes("/iiif/3/")) {
    alternate = resourceId.replace("/iiif/3/", "/iiif/2/");
  } else if (resourceId.includes("/iiif/2/")) {
    alternate = resourceId.replace("/iiif/2/", "/iiif/3/");
  }

  return [...new Set([resourceId, alternate].filter(Boolean))];
}

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "maktaba-integrity-audit/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw new Error(`Unable to fetch ${url}: ${lastError.message}`);
}

function loadCachedSource(profile, bucket, publishKey) {
  const output = execFileSync(
    "aws",
    [
      "s3",
      "cp",
      `s3://${bucket}/sources/${publishKey}.json`,
      "-",
      "--profile",
      profile,
      "--region",
      "us-east-1",
    ],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
  );
  return JSON.parse(output);
}

async function mapWithLimit(values, limit, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await callback(values[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function annotationsFromManifest(manifest) {
  return asArray(manifest.items).flatMap((canvas) =>
    asArray(canvas.annotations).flatMap((page) =>
      asArray(page.items).map((annotation) => ({ annotation, canvas }))
    )
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.profile || !options.table) {
    usage();
    process.exitCode = 2;
    return;
  }

  const items = scanTable(options.profile, options.table);
  const allMetadata = items.filter((item) => item.sortKey === "METADATA");
  const metadata = options.publicOnly
    ? allMetadata.filter((item) => item.publicStatus === true)
    : allMetadata;
  const metadataByUri = new Map(allMetadata.map((item) => [item.uri, item]));
  const auditedUris = new Set(metadata.map((item) => item.uri));
  const recordsByUri = new Map();
  for (const item of items.filter((entry) => entry.sortKey !== "METADATA")) {
    if (!recordsByUri.has(item.uri)) recordsByUri.set(item.uri, new Map());
    recordsByUri.get(item.uri).set(item.sortKey, item);
  }

  const matchedSortKeys = new Set();
  const sourceErrors = [];
  const publicationFailures = [];
  let expectedPublishedAnnotations = 0;
  let matchedAnnotationRecords = 0;
  let visibleSourceCanvases = 0;

  await mapWithLimit(metadata, 5, async (manifestMetadata) => {
    try {
      let source;
      if (options.sourceCacheBucket && manifestMetadata.publishKey) {
        source = loadCachedSource(
          options.profile,
          options.sourceCacheBucket,
          manifestMetadata.publishKey
        );
      } else {
        try {
          source = await fetchJson(manifestMetadata.uri);
        } catch (error) {
          if (
            !options.publishedBaseUrl ||
            manifestMetadata.publicStatus !== true ||
            !manifestMetadata.publishKey
          ) {
            throw error;
          }

          source = await fetchJson(
            `${options.publishedBaseUrl.replace(/\/$/, "")}/${manifestMetadata.publishKey}.json`
          );
        }
      }
      const storedRecords = recordsByUri.get(manifestMetadata.uri) || new Map();
      const visibleCanvases = [];

      for (const canvas of sourceCanvases(source)) {
        const candidates = resourceIdCandidates(canvas.resourceId);

        for (const prefix of ["CANVAS", "NOTE", "TRANSCRIPTION", "TRANSLATION"]) {
          for (const resourceId of candidates) {
            const sortKey = `${prefix}#${resourceId}`;
            if (storedRecords.has(sortKey)) {
              matchedSortKeys.add(`${manifestMetadata.uri}\u0000${sortKey}`);
            }
          }
        }

        const hideRecord = candidates
          .map((resourceId) => storedRecords.get(`CANVAS#${resourceId}`))
          .find(Boolean);
        if (hideRecord?.hide === true) continue;

        const expected = ["TRANSCRIPTION", "TRANSLATION"].filter((prefix) => {
          const record = candidates
            .map((resourceId) => storedRecords.get(`${prefix}#${resourceId}`))
            .find(Boolean);
          return Boolean(record?.value);
        }).length;
        matchedAnnotationRecords += expected;
        visibleCanvases.push({ ...canvas, expected });
      }

      visibleSourceCanvases += visibleCanvases.length;

      if (manifestMetadata.publicStatus === true) {
        expectedPublishedAnnotations += visibleCanvases.reduce(
          (sum, canvas) => sum + canvas.expected,
          0
        );
      }

      if (options.publishedBaseUrl && manifestMetadata.publicStatus === true) {
        const publishedUrl = `${options.publishedBaseUrl.replace(/\/$/, "")}/${manifestMetadata.publishKey}.json`;
        const published = await fetchJson(publishedUrl);
        const publishedAnnotations = annotationsFromManifest(published);
        const badTargets = publishedAnnotations.filter(
          ({ annotation, canvas }) =>
            (typeof annotation.target === "string" ? annotation.target : annotation.target?.id) !==
            canvas.id
        ).length;
        const expected = visibleCanvases.reduce((sum, canvas) => sum + canvas.expected, 0);

        if (
          asArray(published.items).length !== visibleCanvases.length ||
          publishedAnnotations.length !== expected ||
          badTargets > 0
        ) {
          publicationFailures.push({
            actualAnnotations: publishedAnnotations.length,
            actualCanvases: asArray(published.items).length,
            badTargets,
            expectedAnnotations: expected,
            expectedCanvases: visibleCanvases.length,
            provider: manifestMetadata.provider,
            publishedUrl,
            sourceUri: manifestMetadata.uri,
          });
        }
      }
    } catch (error) {
      sourceErrors.push({ sourceUri: manifestMetadata.uri, error: error.message });
    }
  });

  const dataRecords = items.filter(
    (item) => item.sortKey !== "METADATA" && auditedUris.has(item.uri)
  );
  const undefinedRecords = dataRecords.filter((item) => item.sortKey.endsWith("#undefined"));
  const unmatchedRecords = dataRecords.filter(
    (item) => !matchedSortKeys.has(`${item.uri}\u0000${item.sortKey}`)
  );

  const summary = {
    table: options.table,
    profile: options.profile,
    totalItems: items.length,
    manifests: metadata.length,
    publicManifests: allMetadata.filter((item) => item.publicStatus === true).length,
    visibleSourceCanvases,
    matchedAnnotationRecords,
    expectedPublishedAnnotations,
    undefinedRecords: undefinedRecords.length,
    unmatchedRecords: unmatchedRecords.length,
    sourceErrors: sourceErrors.length,
    publicationFailures: publicationFailures.length,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (undefinedRecords.length) {
    console.log("\nUndefined keys:");
    console.table(
      undefinedRecords.map(({ sortKey, uri }) => ({
        provider: metadataByUri.get(uri)?.provider,
        sortKey,
        uri,
      }))
    );
  }
  if (sourceErrors.length) {
    console.log("\nSource errors:");
    console.table(sourceErrors);
  }
  if (publicationFailures.length) {
    console.log("\nPublication mismatches:");
    console.table(publicationFailures);
  }

  if (
    sourceErrors.length ||
    publicationFailures.length ||
    (options.strict && (undefinedRecords.length || unmatchedRecords.length))
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
