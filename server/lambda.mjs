import { generateScript } from "./services/scriptGen.mjs";
import { generateImage } from "./services/imageGen.mjs";
import { startVideo, checkVideo } from "./services/videoGen.mjs";

const headers = {
 "Content-Type": "application/json",
 "Access-Control-Allow-Origin": "*",
 "Access-Control-Allow-Methods": "POST,OPTIONS",
 "Access-Control-Allow-Headers": "Content-Type",
};

const ok = (body) => ({ statusCode: 200, headers, body: JSON.stringify(body) });
const err = (msg, code = 500) => ({ statusCode: code, headers, body: JSON.stringify({ error: msg }) });

export const handler = async (event) => {
 if (event.requestContext?.http?.method === "OPTIONS") return ok("");

 const path = event.requestContext?.http?.path;

 try {
   if (path === "/api/generate") {
     const { prompt } = JSON.parse(event.body || "{}");
     if (!prompt) return err("prompt is required", 400);
     const bucket = process.env.S3_VIDEO_BUCKET;
     const script = await generateScript(prompt);
     const scenes = script.scenes || [];
     const characters = script.characters || [];

     // Look up characters by name so we can inject only those present in a scene.
     const charByName = new Map(
       characters.map((c) => [String(c.name || "").toUpperCase(), c])
     );

     const images = await Promise.all(
       scenes.map((s, i) => {
         const basePrompt = s.visualPrompt || s.description || "";

         // Only describe characters actually in this scene, and keep it short.
         const present = Array.isArray(s.charactersPresent) && s.charactersPresent.length
           ? s.charactersPresent
           : characters.map((c) => c.name);
         const sceneChars = present
           .map((name) => charByName.get(String(name).toUpperCase()))
           .filter(Boolean);
         const charTag = sceneChars.length
           ? " Featuring " +
             sceneChars.map((c) => `${c.name} (${c.gender || "person"}, ${c.appearance})`).join("; ") +
             "."
           : "";

         // Scene action first, then the specific people in frame.
         const fullPrompt = `${basePrompt}${charTag}`;

         // Distinct, well-separated seed per scene so repeated-character scenes
         // don't collapse into near-identical images.
         const seed = Math.floor(Math.random() * 4294967295);
         return generateImage(fullPrompt, bucket, seed);
       })
     );
     return ok({ script, images });
   }

   if (path === "/api/video/start") {
     const { prompt } = JSON.parse(event.body || "{}");
     if (!prompt) return err("prompt is required", 400);
     const result = await startVideo(prompt, process.env.S3_VIDEO_BUCKET_EAST);
     return ok(result);
   }

   if (path === "/api/video/status") {
     const { invocationArn, bucket, key } = JSON.parse(event.body || "{}");
     if (!invocationArn) return err("invocationArn is required", 400);
     const result = await checkVideo(invocationArn, bucket, key);
     return ok(result);
   }

   return err("Not found", 404);
 } catch (e) {
   console.error(e);
   return err(e.message);
 }
};
