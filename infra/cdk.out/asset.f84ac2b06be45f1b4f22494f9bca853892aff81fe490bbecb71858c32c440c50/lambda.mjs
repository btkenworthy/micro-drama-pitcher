import { generateScript } from "./services/scriptGen.mjs";
import { generateImage } from "./services/imageGen.mjs";
import { generateVideo } from "./services/videoGen.mjs";

export const handler = async (event) => {
 const headers = {
   "Content-Type": "application/json",
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Methods": "POST,OPTIONS",
   "Access-Control-Allow-Headers": "Content-Type",
 };

 if (event.requestContext?.http?.method === "OPTIONS") {
   return { statusCode: 200, headers, body: "" };
 }

 try {
   const { prompt, generateVideos = false } = JSON.parse(event.body || "{}");
   if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: "prompt is required" }) };

   const script = await generateScript(prompt);
   const scenes = script.scenes || [];
   const images = await Promise.all(
     scenes.map((s) => generateImage(s.visualPrompt || s.description))
   );

   let video = null;
   if (generateVideos && scenes.length > 0) {
     video = await generateVideo(scenes[0].visualPrompt || scenes[0].description);
   }

   return { statusCode: 200, headers, body: JSON.stringify({ script, images, video }) };
 } catch (err) {
   console.error(err);
   return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
 }
};
