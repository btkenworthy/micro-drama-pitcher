import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

const SYSTEM_PROMPT = `You are a micro drama screenwriter. Given an idea, produce a short script (3-5 scenes) formatted as JSON:
{
  "title": "string",
  "logline": "one sentence summary",
  "genre": "string",
  "scenes": [
    {
      "sceneNumber": 1,
      "heading": "INT/EXT. LOCATION - TIME",
      "description": "scene action description",
      "dialogue": [{ "character": "NAME", "line": "dialogue" }],
      "mood": "string",
      "visualPrompt": "detailed image generation prompt for this scene"
    }
  ]
}
Return ONLY valid JSON, no markdown.`;

export async function generateScript(idea) {
  const payload = {
    messages: [
      { role: "user", content: [{ text: `${SYSTEM_PROMPT}\n\nIdea: ${idea}` }] },
    ],
    inferenceConfig: { maxTokens: 2048, temperature: 0.8 },
  };

  const command = new InvokeModelCommand({
    modelId: "amazon.nova-lite-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));
  const text = body.output?.message?.content?.[0]?.text || "{}";

  try {
    return JSON.parse(text);
  } catch {
    return { title: "Untitled", logline: "", genre: "", scenes: [], raw: text };
  }
}
