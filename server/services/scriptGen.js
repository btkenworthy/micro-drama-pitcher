import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

const SYSTEM_PROMPT = `You are a micro drama screenwriter. Given an idea, produce a short script (3-5 scenes) formatted as JSON:
{
  "title": "string",
  "logline": "one sentence summary",
  "genre": "string",
  "characters": [
    {
      "name": "CHARACTER NAME",
      "appearance": "detailed physical description: age, gender, ethnicity, hair color/style, eye color, build, height, facial features, distinguishing marks"
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "heading": "INT/EXT. LOCATION - TIME",
      "description": "scene action description",
      "dialogue": [{ "character": "NAME", "line": "dialogue text only, no parentheticals or stage directions" }],
      "mood": "string",
      "visualPrompt": "detailed image generation prompt for this scene - DO NOT describe character appearances here, only actions, poses, expressions, setting, lighting, and camera angle"
    }
  ]
}
CRITICAL JSON RULES:
- Return ONLY valid JSON, no markdown code fences
- All string values MUST use straight double quotes
- Dialogue lines must be plain text strings, NO parenthetical stage directions like (smiling)
- Do NOT use curly/smart quotes
- Do NOT use trailing commas
IMPORTANT: The "characters" array must contain every named character with a highly specific, consistent physical description. The "visualPrompt" for each scene should describe the scene composition, setting, lighting, and what characters are doing, but NOT re-describe their physical appearance (that will be injected separately).`;

function removeTrailingCommas(str) {
  return str.replace(/,\s*([\]}])/g, '$1');
}

function extractJSON(text) {
  // Try parsing as-is first
  try { return JSON.parse(text); } catch {}

  // Strip markdown code fences
  const fenceStripped = text.replace(/```[\w]*\s*\n?/g, "").trim();
  try { return JSON.parse(fenceStripped); } catch {}

  // Strategy 1: Replace curly quotes with straight equivalents (handles structural curly quotes)
  const straightened = fenceStripped
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/\\'/g, "'");
  try { return JSON.parse(straightened); } catch {}
  try { return JSON.parse(removeTrailingCommas(straightened)); } catch {}

  // Strategy 2: Escape curly double quotes (handles curly quotes inside values like 5'6\u201D)
  const escaped = fenceStripped
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '\\"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/\\'/g, "'");
  try { return JSON.parse(escaped); } catch {}
  try { return JSON.parse(removeTrailingCommas(escaped)); } catch {}

  // Strategy 3: Extract { ... } block and try both approaches
  const match = fenceStripped.match(/\{[\s\S]*\}/);
  if (match) {
    const block = match[0];
    const s1 = block.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'").replace(/\\'/g, "'");
    try { return JSON.parse(s1); } catch {}
    try { return JSON.parse(removeTrailingCommas(s1)); } catch {}
    const s2 = block.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '\\"').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'").replace(/\\'/g, "'");
    try { return JSON.parse(s2); } catch {}
    try { return JSON.parse(removeTrailingCommas(s2)); } catch {}
  }

  return null;
}

export async function generateScript(idea) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = {
      messages: [
        { role: "user", content: [{ text: `${SYSTEM_PROMPT}\n\nIdea: ${idea}` }] },
      ],
      inferenceConfig: { maxTokens: 8192, temperature: 0.5 },
    };

    const command = new InvokeModelCommand({
      modelId: "us.amazon.nova-2-lite-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await client.send(command);
    const rawBody = new TextDecoder().decode(response.body);
    const body = JSON.parse(rawBody);
    console.log("Nova 2 stopReason:", body.stopReason);
    const text = body.output?.message?.content?.[0]?.text || "{}";

    const parsed = extractJSON(text);
    if (parsed && parsed.title) return parsed;

    console.warn(`Attempt ${attempt + 1}: Failed to parse. Retrying...`);
  }

  return { title: "Untitled", logline: "", genre: "", scenes: [] };
}
