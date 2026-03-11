import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { generateScript } from "./services/scriptGen.js";
import { generateImage } from "./services/imageGen.js";
import { generateVideo } from "./services/videoGen.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "../client/dist")));

// Generate full pitch: script + images + optional video
app.post("/api/generate", async (req, res) => {
  const { prompt, generateVideos = false } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  try {
    // 1. Generate script
    const script = await generateScript(prompt);

    // 2. Generate an image per scene
    const scenes = script.scenes || [];
    const images = await Promise.all(
      scenes.map((scene) => generateImage(scene.visualPrompt || scene.description))
    );

    // 3. Optionally generate video for key scene
    let video = null;
    if (generateVideos && scenes.length > 0) {
      video = await generateVideo(scenes[0].visualPrompt || scenes[0].description);
    }

    res.json({ script, images, video });
  } catch (err) {
    console.error("Generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "../client/dist/index.html")));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
