const TWELVE_LABS_BASE = "https://api.twelvelabs.io/v1.3";

export async function generateVideo(prompt) {
  const apiKey = process.env.TWELVE_LABS_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(`${TWELVE_LABS_BASE}/generate`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text: `Cinematic micro drama scene: ${prompt}`, duration: 6 }),
  });

  if (!res.ok) {
    console.error("Twelve Labs error:", await res.text());
    return null;
  }

  const data = await res.json();
  return data.video_url || null;
}
