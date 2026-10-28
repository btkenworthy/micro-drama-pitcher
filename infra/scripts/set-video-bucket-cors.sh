#!/usr/bin/env bash
# Applies the CORS rule that lets the site (CloudFront origin) fetch Nova Reel
# videos from the us-east-1 output bucket via presigned URLs, so they can be
# bundled into client-side exports. The bucket is not CDK-managed (it is only
# referenced by name in infra/stack.mjs), so CORS is applied here instead.
# Idempotent: put-bucket-cors replaces the whole CORS config with the JSON file.
set -euo pipefail

EXPECTED_ACCOUNT="990791707985"
REGION="us-east-1"
BUCKET="micro-drama-video-${EXPECTED_ACCOUNT}-${REGION}"
PROFILE="${AWS_PROFILE:-btken@amazon.com}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORS_FILE="${SCRIPT_DIR}/video-bucket-cors.json"

ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo "Refusing to run: profile '$PROFILE' is account '$ACCOUNT', expected '$EXPECTED_ACCOUNT'." >&2
  exit 1
fi

aws s3api put-bucket-cors \
  --profile "$PROFILE" \
  --region "$REGION" \
  --bucket "$BUCKET" \
  --cors-configuration "file://${CORS_FILE}"

echo "Applied CORS to s3://${BUCKET}:"
aws s3api get-bucket-cors --profile "$PROFILE" --region "$REGION" --bucket "$BUCKET"
