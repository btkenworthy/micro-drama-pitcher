# Micro Drama Pitcher — Image Generation Notes / Handoff

Last updated: 2026-08-25

This file captures the state of the image-generation work so a future session can
pick up without the original chat history.

## TL;DR — current state

- Image model: **Stability SD3.5 Large** (`stability.sd3-5-large-v1:0`) via Bedrock, **text-to-image** mode.
- Script model: **Amazon Nova 2 Lite** (`us.amazon.nova-2-lite-v1:0`).
- The app currently produces **prompt-accurate, visually distinct scenes** with
  **rough (description-level) character consistency** — NOT locked faces across scenes.
- This is the "works better" state we intentionally reverted to after two failed
  continuity experiments (see History).

## Deployment facts

- Account used daily: **RnD `990791707985`** (Isengard/Conduit). Creds expire ~hourly.
  - Working local AWS profile for this account: **`btken@amazon.com`**
    (the `default`/`rnd` profiles were stale/empty during this work).
- Correct region: **us-west-2**. (One deploy accidentally went to us-east-1 and was deleted.)
- Deploy from the `infra/` directory. `cdk.json` runs `node stack.mjs`, and the REAL
  stack is **`infra/stack.mjs`** (wires S3_VIDEO_BUCKET, video routes, Nova Reel perms,
  bundles Lambda from `../server`). The root `./stack.mjs` is an older, simpler copy — do not use.
- Deploy command actually used:
  ```bash
  cd infra
  export AWS_PROFILE="btken@amazon.com"
  export CDK_DEFAULT_REGION="us-west-2"
  export AWS_REGION="us-west-2"
  npx cdk deploy --require-approval never --output cdk.out.uswest2
  ```
- Current live outputs (us-west-2):
  - Site: https://d2ar2bjd3rjebg.cloudfront.net
  - API:  https://d41jrpg1x3.execute-api.us-west-2.amazonaws.com

## Files that matter (edit these; others are stale)

- `server/lambda.mjs` — request handler; builds the per-scene image prompt.
- `server/services/imageGen.mjs` — SD3.5 text-to-image call.
- `server/services/scriptGen.mjs` — Nova prompt; enforces character gender + per-scene `charactersPresent`.
- NOTE: `server/services/*.js` copies and everything under `infra/cdk.out/` are **stale build
  artifacts** and are NOT used by the deploy (Lambda bundles from `server/` *.mjs).

## What was fixed (root cause of "images barely follow prompts")

Original bug: every scene prompt was
`"Cinematic still frame... anamorphic lens: [ALL characters' full appearances] Scene: [action]"`.
The style clause + full appearance dump led the prompt and scenes never said WHO was in
frame or their gender → SD3.5 rendered the same generic man every scene, no women.

Fixes now in place:
1. `scriptGen.mjs`: each character has `gender` + a SHORT appearance; each scene has
   `charactersPresent` and a `visualPrompt` that leads by stating who is in frame.
2. `lambda.mjs`: injects only the characters present in a scene as a short trailing
   `Featuring NAME (gender, appearance)` tag; scene action leads. Fresh random seed per scene.
3. `imageGen.mjs`: scene leads, cinematic style is a trailing suffix; added `negative_prompt`
   (targets extra people / wrong gender / cloned face) and a `seed`.

Confirmed working with the test prompt:
"Hospital Drama where lead surgeon is having an affair with a female intern and his wife
is Chief of Medical Staff at same hospital." — now renders the correct mix of characters
(e.g. the female Chief of Medical Staff shows up), not the same man 4x.

## History of continuity experiments (why we're at text-to-image)

Attempt 1 — SD3.5 image-to-image, per-character "hero" reference, `strength: 0.75`
  → faces DRIFTED between scenes.
Attempt 2 — same approach, `strength: 0.6`
  → scenes sharing a character COLLAPSED into near-identical images (same pose/background/crop).

Conclusion: SD3.5 image-to-image on Bedrock conditions on the WHOLE reference frame, so
`strength` couples identity and composition — there is no single value giving
"same face, different scene". Global strength tuning cannot solve this. Reverted to
text-to-image (current state).

## Option B — the planned follow-up (true face-lock)

Goal: same character face across scenes WITHOUT cloning the whole frame (identity-only
conditioning).

Recommended approach: **Amazon Nova Canvas image conditioning** (its reference/conditioning
modes are built for "keep the subject, change the scene"). This is the right Bedrock tool
for character continuity; SD3.5 on Bedrock is not.

Sketch of the change (mostly contained to `imageGen.mjs`, plus the hero-reference step in
`lambda.mjs`):
1. For each character, generate one Nova Canvas reference image (text-to-image).
2. For each scene, call Nova Canvas in a conditioning mode, passing the primary present
   character's reference as the conditioning/reference image + the scene prompt.
3. Keep the existing gender-aware prompt building and `charactersPresent` logic.

Watch-outs for Option B:
- Verify Nova Canvas model access is enabled in the target account/region.
- Confirm the exact Nova Canvas request shape (taskType, conditioning params, base64 fields)
  from current Bedrock docs before coding — API differs entirely from SD3.5.
- Multi-character scenes: reference only anchors one subject; decide how to handle scenes
  with 2+ known characters.
- Latency/cost: reference images + scene images ≈ doubles calls (still within the 15-min
  Lambda timeout).

## Tuning knobs (current text-to-image build)

- Style look: `STYLE_SUFFIX` in `server/services/imageGen.mjs`.
- Things to avoid: `NEGATIVE_PROMPT` in the same file.
- Scene variety: seed is random per scene in `lambda.mjs` (was deterministic; randomized so
  repeated-character scenes don't look the same).

## Export feature

Deployed to RnD `990791707985` / us-west-2 (static site assets only; the CDK diff showed just
the `DeploySite` BucketDeployment source change).

What it does: after a pitch is generated, the site offers two downloads, both built in the browser:
- **ZIP package** (`<slug>.zip`, files at the root): `pitch.json`, `script.md`, `images/scene-NN.*`,
  `pitch-deck.pdf`, the video when it's available, and `README.txt` listing any assets that were
  skipped and why.
- **Standalone PDF deck** (`<slug>.pdf`).

Blob prefetch cache (`client/src/assetCache.js`): scene images are fetched into in-memory blobs
right after generation, and the video is fetched once its job completes. Export reads from these
blobs, so it still works after the presigned S3 URLs expire.

Files touched:
- `client/src/App.jsx`: export buttons, progress live region, prefetch wiring.
- `client/src/assetCache.js` (new): blob prefetch cache.
- `client/src/exportPackage.js` (new): ZIP/PDF assembly (jszip, jspdf).
- `client/package.json`, `client/package-lock.json`: pinned `jszip@3.10.2` and `jspdf@4.2.1`.
- (Other modified files in `git status`, like `server/*`, `infra/stack.mjs`, and `README.md`, come
  from earlier image/video sessions, not from this feature.)

Why client-side: packaging in the browser adds no API routes, Lambda code, auth, CORS, or network
config. That means no new unauthenticated endpoints and no new security surface. The existing API is
unchanged.

Caveats:
- Presigned URLs last **1 hour**. If an asset's prefetch failed, or the page was reloaded (the cache
  is memory-only), that asset can't be exported after expiry. Regenerate the pitch.
- The us-west-2 image/video bucket allows CORS GET from `*`, so image prefetch works. The us-east-1
  Nova Reel bucket (`micro-drama-video-990791707985-us-east-1`) has **no CORS config** (checked
  2026-08-25), so video prefetch will probably fail and the video will show up in `README.txt` as
  skipped. Fixed since, see "Video bucket CORS" below.
- The three earlier minor review items are fixed; see "Follow-up fixes" below.

### Video bucket CORS (us-east-1 Nova Reel bucket)

Applied to `micro-drama-video-990791707985-us-east-1` so the browser can prefetch the video for
exports. The rule (`infra/scripts/video-bucket-cors.json`): `GET`/`HEAD` only, origin
`https://d2ar2bjd3rjebg.cloudfront.net` only (no `*`; the Vite dev server runs on port 8080 and isn't
listed), no `AllowedHeaders` (the export does a plain `fetch` with no custom request headers),
`ExposeHeaders` `Content-Length`/`Content-Type`, `MaxAgeSeconds` 3000. CORS only tells browsers which
origins may read responses. Objects still require a presigned URL; anonymous GETs return 403.

Why it lives outside CDK: `infra/stack.mjs` only builds this bucket's name as a string (for the
Lambda env var and IAM policy). The bucket isn't a CDK resource, so CDK can't set its CORS.

Re-apply (idempotent; replaces the bucket's whole CORS config with the JSON file):
```
./infra/scripts/set-video-bucket-cors.sh   # uses profile btken@amazon.com, override with AWS_PROFILE
```
The script refuses to run if the account isn't `990791707985`. To allow local dev, add
`http://localhost:8080` to `AllowedOrigins` and re-run.
Full path: `/Users/btken/Desktop/micro-drama-pitcher/infra/scripts/set-video-bucket-cors.sh`.

### Follow-up fixes (video download + three small issues)

- **Video failure reasons** (`exportPackage.js` `videoFailureReason`/`describeReason`,
  `assetCache.js` `fetchAssetBlob`): a fetch TypeError (e.g. CORS) maps to `video-blocked`, HTTP 403
  to `video-expired`, any other HTTP status to `video-http-error`, and a missing URL to
  `video-not-generated`/`video-still-generating`. A CORS block is no longer relabelled "expired"
  after 1 h, and the "regenerate" advice only appears for genuine expiry. The UI message and
  `README.txt` share the same wording.
- **Position-based file names**: images are named `images/scene-NN.*` from their position
  (`i + 1`, zero-padded), so names are always unique even if `sceneNumber` repeats or is missing.
  `sceneNumber` still appears in labels, `pitch.json`, `script.md`, and the PDF.
- **Focus / aria-live** (`App.jsx`): export buttons use `aria-disabled` instead of `disabled`, so
  keyboard focus stays put; a synchronous busy guard blocks double-clicks. `#export-status` is
  `role="status" aria-live="polite"` and announces progress and completion; errors use
  `role="alert"`.

Deployed 2026-10-27 to RnD `990791707985` / us-west-2: success (`cdk diff` showed only the
`DeploySite` BucketDeployment source change; no Lambda/API change). Outputs unchanged: Site
https://d2ar2bjd3rjebg.cloudfront.net, API https://d41jrpg1x3.execute-api.us-west-2.amazonaws.com.
CloudFront serves the new bundle (`assets/index-DEAIV4td.js`, matching `client/dist`).
