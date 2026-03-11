import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

export async function generateImage(prompt) {
  const payload = {
    taskType: "TEXT_IMAGE",
    textToImageParams: { text: `Cinematic still, film scene: ${prompt}` },
    imageGenerationConfig: { numberOfImages: 1, height: 720, width: 1280, quality: "standard" },
  };

  const command = new InvokeModelCommand({
    modelId: "amazon.nova-canvas-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));
  const base64 = body.images?.[0];
  return base64 ? `data:image/png;base64,${base64}` : null;
}
