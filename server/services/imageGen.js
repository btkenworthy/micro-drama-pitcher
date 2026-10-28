import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-west-2" });
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

export async function generateImage(prompt, s3Bucket) {
  const command = new InvokeModelCommand({
    modelId: "stability.sd3-5-large-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      prompt: `Cinematic still frame from a film, consistent cinematic color grading, anamorphic lens: ${prompt}`,
      mode: "text-to-image",
      aspect_ratio: "16:9",
      output_format: "png",
    }),
  });

  const response = await bedrock.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));
  const base64 = body.images?.[0];
  if (!base64) return null;

  if (s3Bucket) {
    const key = `images/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    await s3.send(new PutObjectCommand({
      Bucket: s3Bucket, Key: key,
      Body: Buffer.from(base64, "base64"), ContentType: "image/png",
    }));
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: s3Bucket, Key: key }), { expiresIn: 3600 });
    return { url, s3Key: key };
  }
  return { url: `data:image/png;base64,${base64}`, s3Key: null };
}
