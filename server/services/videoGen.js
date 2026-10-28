import { BedrockRuntimeClient, StartAsyncInvokeCommand, GetAsyncInvokeCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const VIDEO_REGION = "us-east-1";
const bedrock = new BedrockRuntimeClient({ region: VIDEO_REGION, maxAttempts: 5 });
const s3 = new S3Client({ region: VIDEO_REGION });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function startVideo(prompt, s3Bucket) {
  if (!s3Bucket) return null;
  const key = `videos/${Date.now()}`;

  const modelInput = {
    taskType: "TEXT_VIDEO",
    textToVideoParams: {
      text: `Cinematic micro drama scene: ${prompt}`.substring(0, 512),
    },
    videoGenerationConfig: { durationSeconds: 6, fps: 24, dimension: "1280x720" },
  };

  const command = new StartAsyncInvokeCommand({
    modelId: "amazon.nova-reel-v1:1",
    contentType: "application/json",
    accept: "application/json",
    modelInput,
    outputDataConfig: { s3OutputDataConfig: { s3Uri: `s3://${s3Bucket}/${key}/` } },
  });

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const { invocationArn } = await bedrock.send(command);
      return { invocationArn, bucket: s3Bucket, key };
    } catch (e) {
      if (e.name === "ServiceUnavailableException" || e.$metadata?.httpStatusCode === 503) {
        console.warn(`Video start attempt ${attempt + 1} got 503, retrying...`);
        await sleep(3000 * Math.pow(2, attempt));
        continue;
      }
      throw e;
    }
  }
  const err = new Error("Video generation service is temporarily unavailable. Please try again in a few minutes.");
  err.name = "VideoServiceUnavailable";
  throw err;
}

export async function checkVideo(invocationArn, bucket, key) {
  const status = await bedrock.send(new GetAsyncInvokeCommand({ invocationArn }));
  if (status.status === "Completed") {
    const invocationId = invocationArn.split("/").pop();
    const videoKey = `${key}/${invocationId}/output.mp4`;
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: videoKey }), { expiresIn: 3600 });
    return { status: "Completed", videoUrl: url };
  }
  return { status: status.status, failureMessage: status.failureMessage || null };
}

// Convenience wrapper: starts video and polls until complete or timeout
export async function generateVideo(prompt, s3Bucket, { timeoutMs = 120000 } = {}) {
  const job = await startVideo(prompt, s3Bucket);
  if (!job) return null;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(5000);
    const result = await checkVideo(job.invocationArn, job.bucket, job.key);
    if (result.status === "Completed") return result;
    if (result.status === "Failed") throw new Error(result.failureMessage || "Video generation failed");
  }
  return { status: "InProgress", message: "Video is still generating. Check back later." };
}
