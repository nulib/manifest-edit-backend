#!/usr/bin/env bash

set -euo pipefail

aws_profile="${AWS_PROFILE:-staging}"
aws_region="${AWS_REGION:-us-east-1}"
test_bucket="maktaba-manifest-publish-test-625046682746"
build_directory=".aws-sam/build"

sam build \
  --template-file test/integration/template.yaml \
  --build-dir "$build_directory"

for fixture in northwestern-v3 northwestern-choice; do
  sam local invoke ManifestPublisher \
    --template "$build_directory/template.yaml" \
    --event "test/integration/events/${fixture}.json" \
    --env-vars test/integration/env.staging.json \
    --profile "$aws_profile" \
    --region "$aws_region"

  aws s3 cp \
    "s3://${test_bucket}/integration/${fixture}.json" \
    - \
    --profile "$aws_profile" \
    --region "$aws_region" |
    jq -e '
      . as $manifest |
      ([$manifest.items[]?.annotations[]?.items[]?] | length) == 2 and
      ([
        $manifest.items[]? as $canvas |
        $canvas.items[]?.items[]? |
        ((.target | if type == "string" then . else .id end) == $canvas.id)
      ] | all) and
      ([
        $manifest.items[]? as $canvas |
        $canvas.annotations[]?.items[]? |
        (.motivation == "supplementing") and
        ((.target | if type == "string" then . else .id end) == $canvas.id)
      ] | all)
    ' >/dev/null

  printf 'validated %s\n' "$fixture"
done
