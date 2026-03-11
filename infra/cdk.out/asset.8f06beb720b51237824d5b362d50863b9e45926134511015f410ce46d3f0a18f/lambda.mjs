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
     const images = await Promise.all(
       scenes.map((s) => generateImage(s.visualPrompt || s.description, bucket))
     );
     return ok({ script, images });
   }

   if (path === "/api/video/start") {
     const { prompt } = JSON.parse(event.body || "{}");
     if (!prompt) return err("prompt is required", 400);
     const result = await startVideo(prompt, process.env.S3_VIDEO_BUCKET);
     return ok(result);
   }

   if (path === "/api/video/status") {
     const { invocationArn } = JSON.parse(event.body || "{}");
     if (!invocationArn) return err("invocationArn is required", 400);
     const result = await checkVideo(invocationArn);
     return ok(result);
   }

   return err("Not found", 404);
 } catch (e) {
   console.error(e);
   return err(e.message);
 }
};
