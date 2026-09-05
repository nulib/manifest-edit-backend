#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  isManifest,
  localizeSourceManifest,
  normalizePublishedDerivative,
  sourceManifestKey,
  sourceManifestUri,
} = require("../lambdas/writeManifest/source-manifest");

const USER_AGENT =
  "Maktaba-IIIF-Importer/1.0 (+https://dc.library.northwestern.edu/)";

function parseArgs(argv) {
  const options = { apply: false, overwrite: false, region: "us-east-1" };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--overwrite") options.overwrite = true;
    else if (argument === "--public-only") options["public-only"] = true;
    else if (argument.startsWith("--")) {
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
    }
  }

  for (const required of ["table", "bucket", "profile", "base-url"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }

  return options;
}

function awsJson(args, profile, region, input) {
  return JSON.parse(
    execFileSync(
      "aws",
      [...args, "--profile", profile, "--region", region, "--output", "json"],
      {
        encoding: "utf8",
        input,
        maxBuffer: 50 * 1024 * 1024,
      }
    )
  );
}

function scanMetadata(options) {
  const response = awsJson(
    [
      "dynamodb",
      "scan",
      "--table-name",
      options.table,
      "--filter-expression",
      "sortKey = :metadata",
      "--expression-attribute-values",
      '{":metadata":{"S":"METADATA"}}',
      "--projection-expression",
      "uri,publishKey,provider,publicStatus,label",
      "--consistent-read",
    ],
    options.profile,
    options.region
  );

  return response.Items.map((item) => ({
    label: item.label?.S || item.uri.S,
    provider: item.provider?.S,
    publicStatus: item.publicStatus?.BOOL === true,
    publishKey: item.publishKey.S,
    uri: item.uri.S,
  }));
}

function cacheExists(options, key) {
  try {
    awsJson(
      ["s3api", "head-object", "--bucket", options.bucket, "--key", key],
      options.profile,
      options.region
    );
    return true;
  } catch (error) {
    return false;
  }
}

async function fetchJson(uri) {
  const response = await fetch(uri, {
    headers: {
      Accept: "application/ld+json, application/json;q=0.9",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.toLowerCase().includes("json")) {
    throw new Error(
      `${uri} returned HTTP ${response.status} (${contentType || "unknown content type"})`
    );
  }

  const manifest = await response.json();
  if (!isManifest(manifest)) throw new Error(`${uri} is not a IIIF Manifest`);
  return manifest;
}

function getS3Json({ bucket, key, profile, region, versionId }) {
  const directory = mkdtempSync(join(tmpdir(), "maktaba-source-"));
  const outputPath = join(directory, "manifest.json");

  try {
    const args = ["s3api", "get-object", "--bucket", bucket, "--key", key];
    if (versionId) args.push("--version-id", versionId);
    args.push(outputPath, "--profile", profile, "--region", region);
    execFileSync("aws", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(readFileSync(outputPath, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function historicalVersions(options, publishKey) {
  if (!options["historical-bucket"] || !options["historical-profile"]) {
    return [];
  }

  const key = `${publishKey}.json`;
  const response = awsJson(
    ["s3api", "list-object-versions", "--bucket", options["historical-bucket"], "--prefix", key],
    options["historical-profile"],
    options.region
  );

  const exactVersions = (response.Versions || []).filter(
    (version) => version.Key === key
  );
  const bySize = new Map();
  for (const version of exactVersions) {
    const previous = bySize.get(version.Size);
    if (!previous || version.LastModified > previous.LastModified) {
      bySize.set(version.Size, version);
    }
  }

  const newestBySize = [...bySize.values()]
    .sort((a, b) => b.Size - a.Size)
    .slice(0, 20);
  const oldest = exactVersions.sort((a, b) =>
    a.LastModified.localeCompare(b.LastModified)
  )[0];

  if (oldest && !newestBySize.some((version) => version.VersionId === oldest.VersionId)) {
    newestBySize.push(oldest);
  }

  return newestBySize;
}

function bestHistoricalDerivative(options, item) {
  const candidates = historicalVersions(options, item.publishKey);
  let best;

  for (const version of candidates) {
    const manifest = getS3Json({
      bucket: options["historical-bucket"],
      key: `${item.publishKey}.json`,
      profile: options["historical-profile"],
      region: options.region,
      versionId: version.VersionId,
    });
    if (!isManifest(manifest)) continue;

    const canvasCount = Array.isArray(manifest.items) ? manifest.items.length : 0;
    if (
      !best ||
      canvasCount > best.canvasCount ||
      (canvasCount === best.canvasCount && version.LastModified > best.lastModified)
    ) {
      best = { canvasCount, lastModified: version.LastModified, manifest };
    }
  }

  if (!best) throw new Error("No historical published derivative is available");
  return normalizePublishedDerivative(best.manifest, item.uri);
}

function putCache(options, key, manifest) {
  const directory = mkdtempSync(join(tmpdir(), "maktaba-cache-"));
  const inputPath = join(directory, "manifest.json");

  try {
    writeFileSync(inputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync(
      "aws",
      [
        "s3api",
        "put-object",
        "--bucket",
        options.bucket,
        "--key",
        key,
        "--body",
        inputPath,
        "--content-type",
        "application/json",
        "--profile",
        options.profile,
        "--region",
        options.region,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function cacheItem(options, item) {
  const key = sourceManifestKey(item.publishKey);
  if (!options.overwrite && cacheExists(options, key)) {
    return { item, key, result: "skipped", source: "existing-cache" };
  }

  let manifest;
  let source = "provider";
  try {
    manifest = await fetchJson(item.uri);
  } catch (providerError) {
    source = "historical-derivative";
    try {
      manifest = bestHistoricalDerivative(options, item);
    } catch (historicalError) {
      throw new Error(`${providerError.message}; ${historicalError.message}`);
    }
  }

  const localizedManifest = localizeSourceManifest(
    manifest,
    sourceManifestUri(options["base-url"], item.publishKey)
  );

  if (options.apply) putCache(options, key, localizedManifest);
  return {
    canvasCount: Array.isArray(localizedManifest.items)
      ? localizedManifest.items.length
      : 0,
    item,
    key,
    result: options.apply ? "cached" : "would-cache",
    source,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const items = scanMetadata(options)
    .filter((item) => !options.provider || item.provider === options.provider)
    .filter((item) => !options["publish-key"] || item.publishKey === options["publish-key"])
    .filter((item) => !options["public-only"] || item.publicStatus)
    .sort((a, b) => a.label.localeCompare(b.label));
  const results = [];

  for (const item of items) {
    try {
      const result = await cacheItem(options, item);
      results.push(result);
      console.log(
        `${result.result}\t${result.source}\t${result.canvasCount ?? "?"} canvases\t${result.key}\t${item.label}`
      );
    } catch (error) {
      const result = { error: error.message, item, result: "missing" };
      results.push(result);
      console.error(`missing\t${item.publicStatus ? "public" : "private"}\t${item.label}\t${error.message}`);
    }
  }

  const missingPublic = results.filter(
    (result) => result.result === "missing" && result.item.publicStatus
  );
  const missingPrivate = results.filter(
    (result) => result.result === "missing" && !result.item.publicStatus
  );
  console.log(
    JSON.stringify(
      {
        apply: options.apply,
        cached: results.filter((result) => result.result === "cached").length,
        missingPrivate: missingPrivate.length,
        missingPublic: missingPublic.length,
        skipped: results.filter((result) => result.result === "skipped").length,
        total: results.length,
        wouldCache: results.filter((result) => result.result === "would-cache").length,
      },
      null,
      2
    )
  );

  if (missingPublic.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { bestHistoricalDerivative, cacheItem, fetchJson, parseArgs };
