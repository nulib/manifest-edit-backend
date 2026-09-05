# Annotation publication recovery workflow

## Staging data

The production `MaktabaManifests` table was copied on 2026-09-04 to the staging account as:

`MaktabaImportFromProd-2026-09-04`

The snapshot is on-demand, has deletion protection enabled, and has point-in-time recovery enabled. Its 440 items were verified against production using a normalized SHA-256 digest. It is intentionally separate from the active staging `MaktabaManifests` table.

Do not point the staging application at the snapshot or delete/replace another table merely to run an audit. The audit is read-only.

## Identifier compatibility

New Northwestern source manifests use IIIF Image API 3 service `id` values containing `/iiif/3/`. Existing DynamoDB records contain both current `/iiif/3/` keys and legacy `/iiif/2/` keys. UIUC manifests continue to expose Image API 2 `@id` values.

The compatibility order is:

1. Read the exact service identifier supplied by the current source manifest.
2. If no record exists, try the equivalent `/iiif/2/` or `/iiif/3/` identifier.
3. Update whichever persisted sort key was found.
4. Create new records under the current source service identifier.

Never use `undefined` as a resource identifier. Existing `#undefined` records require manual review because they do not identify a particular canvas and must not be attached to every canvas.

## Automated checks

Backend pull requests run the canvas-key regression tests plus the CDK build and tests. UI pull requests run Vitest and the Vite production build.

Run the backend key tests locally:

```sh
node --test test/*.test.js
```

Run the packaged publisher in a Lambda-compatible local container. This reads the protected snapshot and writes only to the private staging test bucket, whose objects expire automatically:

```sh
AWS_PROFILE=staging scripts/run-staging-publisher-test.sh
```

The integration fixtures cover a standard Northwestern ImageService3 canvas and a Northwestern `Choice` painting body. The test requires AWS SSO, Docker, SAM CLI, and `jq`. It asserts annotation counts, `supplementing` motivations, and painting/text targets.

Audit the copied staging data against current source manifests:

```sh
node scripts/audit-manifest-integrity.js \
  --profile staging \
  --table MaktabaImportFromProd-2026-09-04
```

Compare expected annotations with the currently published production manifests:

```sh
node scripts/audit-manifest-integrity.js \
  --profile staging \
  --table MaktabaImportFromProd-2026-09-04 \
  --public-only \
  --published-base-url https://iiif-maktaba.dc.library.northwestern.edu
```

That comparison is expected to fail before the repaired publisher is deployed because the current public Northwestern manifests omit their stored annotations.

## Staging release gate

Before a production deployment:

1. Run both repositories' automated test workflows.
2. Deploy the backend branch only to the staging stack after reviewing `cdk diff`.
3. Point a one-off or staging-only publication execution at a writable copy of the snapshot, never the protected snapshot itself.
4. Publish to the staging S3/CloudFront destination.
5. Run the audit with the staging published base URL.
6. Confirm zero publication mismatches, zero bad annotation targets, and no new `#undefined` keys.
7. Manually verify representative Northwestern and UIUC manifests in both Clover and Mirador.
8. Review and explicitly authorize the production deployment and republish.

Rollback consists of reverting the Lambda deployment and republishing. The source annotation data remains in DynamoDB; published S3 objects are versioned by the CDK stack.
