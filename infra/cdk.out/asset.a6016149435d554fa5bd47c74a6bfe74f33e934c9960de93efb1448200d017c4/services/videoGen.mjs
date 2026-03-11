import { BedrockRuntimeClient, StartAsyncInvokeCommand, GetAsyncInvokeCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-west-2" });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function generateVideo(prompt, s3Bucket) {
 if (!s3Bucket) {
   console.warn("S3_VIDEO_BUCKET not set, skipping video generation");
   return null;
 }

 const key = `videos/${Date.now()}`;

 const command = new StartAsyncInvokeCommand({
   modelId: "luma.ray-v2:0",
   contentType: "application/json",
   accept: "application/json",
   modelInput: {
     prompt: `Cinematic micro drama scene: ${prompt}`,
   },
   outputDataConfig: { s3OutputDataConfig: { s3Uri: `s3://${s3Bucket}/${key}` } },
 });

 const { invocationArn } = await client.send(command);
 console.log("Luma Ray invocation started:", invocationArn);

 for (let i = 0; i < 60; i++) {
   await sleep(10000);
   const status = await client.send(new GetAsyncInvokeCommand({ invocationArn }));
   console.log("Luma Ray status:", status.status);

   if (status.status === "Completed") {
     return `https://${s3Bucket}.s3.amazonaws.com/${key}/output.mp4`;
   }
   if (status.status === "Failed") {
     console.error("Luma Ray failed:", status.failureMessage);
     return { error: `Video generation failed: ${status.failureMessage}` };
   }
 }

 return { error: "Video generation timed out" };
}
