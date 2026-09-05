#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join } = require("node:path");
const {
  localizeSourceManifest,
  sourceManifestUri,
} = require("../lambdas/writeManifest/source-manifest");

function parseArgs(argv) {
  const options = { apply: false, region: "us-east-1" };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument.startsWith("--")) {
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
    }
  }

  for (const required of ["bucket", "profile", "base-url"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }

  return options;
}

function awsJson(args, options) {
  return JSON.parse(
    execFileSync(
      "aws",
      [
        ...args,
        "--profile",
        options.profile,
        "--region",
        options.region,
        "--output",
        "json",
      ],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
    )
  );
}

function listSourceKeys(options) {
  const keys = [];
  let continuationToken;

  do {
    const args = [
      "s3api",
      "list-objects-v2",
      "--bucket",
      options.bucket,
      "--prefix",
      "sources/",
    ];
    if (continuationToken) {
      args.push("--continuation-token", continuationToken);
    }

    const response = awsJson(args, options);
    keys.push(
      ...(response.Contents || [])
        .map((object) => object.Key)
        .filter((key) => /^sources\/[^/]+\.json$/.test(key))
    );
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys.sort();
}

function withTemporaryManifest(callback) {
  const directory = mkdtempSync(join(tmpdir(), "maktaba-localize-cache-"));
  const path = join(directory, "manifest.json");

  try {
    return callback(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function getManifest(options, key) {
  return withTemporaryManifest((path) => {
    execFileSync(
      "aws",
      [
        "s3api",
        "get-object",
        "--bucket",
        options.bucket,
        "--key",
        key,
        path,
        "--profile",
        options.profile,
        "--region",
        options.region,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(readFileSync(path, "utf8"));
  });
}

function putManifest(options, key, manifest) {
  withTemporaryManifest((path) => {
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
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
        path,
        "--content-type",
        "application/json",
        "--profile",
        options.profile,
        "--region",
        options.region,
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
  });
}

function publishKeyFromKey(key) {
  return basename(key, ".json");
}

function manifestId(manifest) {
  return manifest.id || manifest["@id"];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  for (const key of listSourceKeys(options)) {
    const publishKey = publishKeyFromKey(key);
    const targetUri = sourceManifestUri(options["base-url"], publishKey);
    const manifest = getManifest(options, key);

    if (manifestId(manifest) === targetUri) {
      results.push({ key, result: "already-local" });
      console.log(`already-local\t${key}`);
      continue;
    }

    const localized = localizeSourceManifest(manifest, targetUri);
    if (options.apply) putManifest(options, key, localized);
    const result = options.apply ? "localized" : "would-localize";
    results.push({ key, result });
    console.log(`${result}\t${key}\t${manifestId(manifest)}\t${targetUri}`);
  }

  const changed = results.filter(
    ({ result }) => result === "localized" || result === "would-localize"
  ).length;
  console.log(
    JSON.stringify(
      { apply: options.apply, changed, total: results.length },
      null,
      2
    )
  );
}

main();
