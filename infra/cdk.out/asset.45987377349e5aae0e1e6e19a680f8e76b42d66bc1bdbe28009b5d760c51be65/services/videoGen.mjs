import { BedrockRuntimeClient, StartAsyncInvokeCommand, GetAsyncInvokeCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-west-2" });
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

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
 const { invocationArn } = await bedrock.send(command);
 return { invocationArn, bucket: s3Bucket, key };
}

export async function checkVideo(invocationArn, bucket, key) {
 const status = await bedrock.send(new GetAsyncInvokeCommand({ invocationArn }));
 if (status.status === "Completed") {
   const prefix = `${key}/${invocationArn.split("/").pop()}/output.mp4`;
   const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: prefix }), { expiresIn: 3600 });
   return { status: "Completed", videoUrl: url };
 }
 return { status: status.status, failureMessage: status.failureMessage || null };
}
