import { BedrockRuntimeClient, StartAsyncInvokeCommand, GetAsyncInvokeCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-west-2" });

export async function startVideo(prompt, s3Bucket) {
 if (!s3Bucket) return null;
 const key = `videos/${Date.now()}`;
 const command = new StartAsyncInvokeCommand({
   modelId: "luma.ray-v2:0",
   contentType: "application/json",
   accept: "application/json",
   modelInput: { prompt: `Cinematic micro drama scene: ${prompt}` },
   outputDataConfig: { s3OutputDataConfig: { s3Uri: `s3://${s3Bucket}/${key}` } },
 });
 const { invocationArn } = await client.send(command);
 return { invocationArn, s3Uri: `https://${s3Bucket}.s3.amazonaws.com/${key}/output.mp4` };
}

export async function checkVideo(invocationArn) {
 const status = await client.send(new GetAsyncInvokeCommand({ invocationArn }));
 return { status: status.status, failureMessage: status.failureMessage || null };
}
