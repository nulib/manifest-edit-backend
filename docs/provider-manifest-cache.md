# Provider manifest cache

The editor and publication pipeline read a provider-manifest derivative from
the versioned manifest asset bucket instead of requesting Northwestern or UIUC
after import. The cache key is derived from the immutable DynamoDB `publishKey`:

```text
sources/<publishKey>.json
```

The public Maktaba derivative remains `<publishKey>.json`. Cached manifests
retain provider-hosted image and Image API service identifiers, so image
requests still go to the providing institution.

The cached manifest's own `id`/`@id` is its Maktaba cache URL. This prevents
IIIF viewers from following the provider manifest URI after they load the
cache. The provider URI remains in DynamoDB and is added to published manifests
as the originating-manifest reference.

## New imports

The UI validates and normalizes the provider manifest once, then includes it as
`sourceManifest` in the metadata `POST`. The metadata Lambda writes the cache
object before creating the DynamoDB metadata record. If metadata creation
fails, it removes the orphaned cache object.

After import, the editor loads `sources/<publishKey>.json`. The provider URI is
retained as the DynamoDB partition key and provenance identifier, but is not an
editor or publication fetch URL.

## Legacy backfill

The migration is dry-run by default. `--apply` is required for S3 writes:

```sh
node scripts/cache-provider-manifests.js \
  --table TABLE \
  --bucket BUCKET \
  --base-url PUBLIC_IIIF_BASE_URL \
  --profile AWS_PROFILE \
  --historical-bucket HISTORICAL_BUCKET \
  --historical-profile HISTORICAL_AWS_PROFILE \
  --apply
```

The migration requests live provider manifests sequentially. If a provider is
unavailable, it can recover the greatest historical canvas set from versioned
Maktaba derivatives, restore the provider manifest ID, and remove Maktaba text
annotation pages. It does not rewrite provider image services.

Historical derivatives may not contain canvases that were hidden before the
first successful publication. Such caches reproduce the current public output
but cannot support unhiding those missing canvases until a clean provider
manifest is recovered.

Localize caches created before this contract was introduced with the dry-run
by default migration below. `--apply` writes new versions of only the changed
objects in the versioned bucket.

```sh
node scripts/localize-provider-manifest-cache.js \
  --bucket BUCKET \
  --base-url PUBLIC_IIIF_BASE_URL \
  --profile AWS_PROFILE \
  --apply
```

## Verification

Audit a publication without contacting external providers:

```sh
node scripts/audit-manifest-integrity.js \
  --profile AWS_PROFILE \
  --table TABLE \
  --source-cache-bucket BUCKET \
  --published-base-url PUBLIC_IIIF_BASE_URL \
  --public-only
```
