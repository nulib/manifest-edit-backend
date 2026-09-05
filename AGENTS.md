# AGENTS.md

## Project purpose

This repository defines the AWS backend and publication pipeline for the Maktaba Collection Workbench. It imports source IIIF manifests from Northwestern University Libraries and the University of Illinois Urbana-Champaign, stores editorial metadata and per-canvas annotations in DynamoDB, and publishes derived IIIF Presentation 3 manifests plus a collection to S3/CloudFront.

The companion React application is `../manifest-edit-ui`. Changes to API payloads, DynamoDB keys, IIIF identifiers, authentication, or publication behavior must be checked against that repository.

## Repository map

- `cdk/`: TypeScript AWS CDK application. `lib/cdk-stack.ts` defines Cognito, API Gateway, DynamoDB, Lambda functions, Amplify, S3, CloudFront, Route 53, and the publish state machine.
- `lambdas/manifests/`: lists manifest metadata records.
- `lambdas/item/`: gets one DynamoDB item by `uri` and `sortKey`.
- `lambdas/metadata/`, `lambdas/canvas/`, `lambdas/annotation/`: API CRUD handlers used by the workbench.
- `lambdas/publish/`: starts the Step Functions publication workflow.
- `lambdas/writeManifest/`: reads the cached provider manifest, converts it to Presentation 3, applies local metadata/canvas state/annotations, and writes the derived manifest to S3.
- `lambdas/writeCollection/`: builds the public collection entirely from stored metadata and writes it to S3.
- `scripts/cache-provider-manifests.js`: backfills cached provider manifests for legacy records, with an explicit `--apply` guard.
- `state-machines/publish-definition.asl.json`: scans public metadata records, publishes manifests and the collection, then invalidates CloudFront.
- `scripts/audit-manifest-integrity.js`: read-only audit of source canvases, persisted annotation keys, and optionally published manifests.
- `docs/annotation-recovery.md`: staging snapshot details and the release workflow for annotation fixes.

## Data and identifier contract

`MaktabaManifests` uses the source manifest URI as the partition key (`uri`). Sort keys are:

- `METADATA`: label, summary, provider, public status, and immutable `publishKey`.
- `CANVAS#<resource-id>`: whether a source canvas is hidden.
- `TRANSCRIPTION#<resource-id>`: Arabic transcription Markdown.
- `TRANSLATION#<resource-id>`: English translation Markdown.
- `NOTE#<resource-id>`: internal notes; notes are not published.

The `<resource-id>` is the stable join key between a source canvas, the UI, and `writeManifest`. Treat this as a persisted data contract, not an implementation detail. The UI and publisher must use the same extraction and normalization logic. Provider manifests may contain IIIF Image API 2 services (`@id`, often `/iiif/2/`) or Image API 3 services (`id`, often `/iiif/3/`). Never change this key scheme without backward-compatible reads or an explicit DynamoDB migration; otherwise saved annotations can remain in the editor database while disappearing from published manifests.

The immutable `publishKey` also identifies the cached provider manifest at `sources/<publishKey>.json` in the manifest asset bucket. New imports must persist this source derivative before the metadata record becomes available. The cached manifest's own `id`/`@id` must be its Maktaba cache URL so IIIF viewers do not dereference the provider URI. The editor and publication pipeline must read this cached object and must not fetch provider manifests after import. The original provider `uri` remains the DynamoDB partition key and provenance identifier. Do not replace the cached source with a Maktaba-published derivative unless it has been normalized to remove local text annotation pages and restore provenance separately. Image and Image API service IDs must continue to reference the providing institution.

In a published manifest, every painting annotation and every transcription/translation annotation must target the ID of its containing derived canvas. When canvas IDs are rewritten, rewrite the painting page/annotation IDs and targets consistently. Hidden-canvas filtering must happen before assigning final canvas indexes.

## Local setup and checks

There is no meaningful root Node package. Work from the package that owns the code.

```sh
cd cdk
npm ci
npm run build
npm test
```

Lambda packages with third-party dependencies have their own lockfiles. CDK bundles those packages with `npm ci --omit=dev` during synthesis/deployment. If working directly on one, install from that directory, for example:

```sh
cd lambdas/writeManifest
npm ci
```

The existing CDK Jest test is only a placeholder; add focused tests for changed behavior. For publication work, prefer fixture-based tests covering both Northwestern Presentation 3/ImageService3 manifests and UIUC Presentation 2/ImageService2 manifests. Assert DynamoDB lookup keys, hidden-canvas behavior, annotation-page contents, and target-to-canvas consistency.

## AWS and deployment safety

- The CDK app reads `maktaba/deploy-config` from AWS Secrets Manager during startup and requires valid AWS account/region credentials even for operations such as synthesis.
- Do not run `cdk deploy`, start a publish execution, modify DynamoDB, invalidate CloudFront, or change production resources unless the user explicitly requests it.
- Use `cdk diff` before any authorized infrastructure deployment.
- Never commit secret values, Cognito tokens, AWS credentials, generated `cdk.out`, or installed dependencies.
- API routes are Cognito-protected. Preserve API Gateway request models and the frontend request shapes together.

## Change conventions

- Keep CommonJS in Lambda handlers and TypeScript in `cdk/` unless a broader migration is explicitly requested.
- Keep AWS resource environment-variable names aligned with the handlers (`MANIFESTS_TABLE`, `MANIFEST_TABLE_NAME`, `BUCKET`, `BASE_URL`, and `PUBLISH_STATE_MACHINE_ARN`).
- Do not silently swallow publication failures. When changing publisher behavior, make failures observable to Step Functions and CloudWatch and test the failure path.
- Preserve source attribution through `seeAlso` and retain valid IIIF Presentation 3 structures.
- Keep changes narrowly scoped. Do not reformat unrelated legacy code while fixing behavior.

## Cross-repository verification

For changes involving annotations or canvases, inspect both:

- Backend publication: `lambdas/writeManifest/index.js`
- UI key creation: `../manifest-edit-ui/src/components/UI/Table/ManifestItemsRow.tsx`, `AnnotationCell.tsx`, `Dialog.tsx`, and `HideCell.tsx`

At minimum, run backend package checks that exist, then run the UI test suite and build from the companion repository. A fix is incomplete if annotations can be saved under a key the publisher does not retrieve.

Use the protected staging snapshot and audit process documented in `docs/annotation-recovery.md`; never repoint an application or publisher at that snapshot for a write test.
