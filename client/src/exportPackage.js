// Client-side export: builds a ZIP bundle and a PDF pitch deck from the
// generated pitch plus the in-memory asset cache (see assetCache.js).
// Pure functions, no DOM/React, so it can be exercised under Node.
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import { getImageUrl, fetchAssetBlob, detectImageFormat, isExpired } from "./assetCache.js";

const EXT = { PNG: "png", JPEG: "jpg", WEBP: "webp" };
const EXPIRY_ADVICE = "Some assets were generated more than ~1 hour ago and their download links have expired. Regenerate the pitch to include them.";

export function slugify(title) {
 const s = String(title || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
   .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
 return s || "micro-drama-pitch";
}

// Helvetica/Courier in jsPDF are WinAnsi only; map common LLM punctuation to ASCII.
export function pdfSafe(text) {
 return String(text == null ? "" : text)
   .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
   .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
   .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
   .replace(/\u2026/g, "...")
   .replace(/[\u00A0\u2007\u202F]/g, " ")
   .replace(/[^\x00-\xFF]/g, "?");
}

function bytesToBase64(bytes) {
 let bin = "";
 for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
 return btoa(bin);
}

export async function blobToDataUrl(blob, mime = "image/png") {
 return "data:" + mime + ";base64," + bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function shortUrl(url) {
 if (!url) return null;
 if (url.startsWith("data:")) {
   const comma = url.indexOf(",");
   return url.slice(0, comma + 1) + "(omitted " + (url.length - comma - 1) + " chars)";
 }
 return url;
}

function pad2(n) { return String(n).padStart(2, "0"); }

function sceneNum(scene, i) {
 return scene && scene.sceneNumber != null && scene.sceneNumber !== "" ? scene.sceneNumber : i + 1;
}

function after(reason, prefix) { return reason.slice(prefix.length); }

export function describeReason(reason) {
 if (reason === "expired") return "download link expired";
 if (reason === "not-generated") return "no image was generated";
 if (reason === "video-still-generating") return "video was not generated (still generating at export time)";
 if (!reason) return reason;
 if (reason.startsWith("fetch-failed: ")) {
   const [first, retry] = after(reason, "fetch-failed: ").split("; ");
   return "could not be downloaded (prefetch: " + first + "; export retry: " + (retry || "n/a") + ")";
 }
 if (reason.startsWith("video-blocked: ")) return "download was blocked (" + after(reason, "video-blocked: ") + "). The video storage may not allow downloads from this site, or the network is unavailable; regenerating will not fix a CORS block";
 if (reason.startsWith("video-expired: ")) return "download link expired (" + after(reason, "video-expired: ") + ")";
 if (reason.startsWith("video-http-error: ")) return "download failed with " + after(reason, "video-http-error: ");
 if (reason.startsWith("video-fetch-failed: ")) return "could not be downloaded (" + after(reason, "video-fetch-failed: ") + ")";
 if (reason.startsWith("video-not-generated: ")) return "video was not generated (" + after(reason, "video-not-generated: ") + ")";
 return reason;
}

export function isExpiryReason(reason) {
 return reason === "expired" || (!!reason && reason.startsWith("video-expired: "));
}

// Picks the real cause of a failed video download: network/CORS block (fetch
// TypeError), HTTP 403 (presigned link expired), or another HTTP status.
// The latest attempt wins unless it is less specific than the prefetch error.
function videoFailureReason(retry, prefetch) {
 const specific = (f) => f && (f.kind === "network" || f.kind === "http");
 const f = specific(retry) ? retry : specific(prefetch) ? prefetch : (retry || prefetch);
 if (!f) return "expired";
 if (f.kind === "network") return "video-blocked: " + f.error;
 if (f.kind === "http" && f.status === 403) return "video-expired: HTTP 403";
 if (f.kind === "http") return "video-http-error: HTTP " + f.status;
 return "video-fetch-failed: " + (f.error || "unknown error");
}

// ZIP file stem for a scene: always its 1-based array position, so names are
// unique even when the model's sceneNumber has gaps, duplicates or is missing.
function sceneFileStem(i) { return "scene-" + pad2(i + 1); }

function sceneImageLabel(scene, i) {
 const n = sceneNum(scene, i);
 return "Scene " + n + " image" + (String(n) !== String(i + 1) ? " (" + sceneFileStem(i) + ")" : "");
}

// Uses cached blobs first. Only assets missing from the cache are retried
// (unless their presigned URL has already expired).
export async function resolveAssets({ script, images, cache, videoUrl, videoState, generatedAt, now = Date.now(), fetchImpl = globalThis.fetch }) {
 const scenes = (script && Array.isArray(script.scenes)) ? script.scenes : [];
 const imgs = Array.isArray(images) ? images : [];
 const cachedImgs = (cache && Array.isArray(cache.images)) ? cache.images : [];
 const genAt = generatedAt != null ? generatedAt : cache && cache.generatedAt;
 const skipped = [];

 const imageAssets = await Promise.all(scenes.map(async (scene, i) => {
   const n = sceneNum(scene, i);
   const label = sceneImageLabel(scene, i);
   const url = getImageUrl(imgs[i]);
   if (!url) { skipped.push({ index: i, label, file: null, url: null, reason: "not-generated" }); return null; }
   const cached = cachedImgs[i];
   let blob = cached && cached.blob;
   if (!blob) {
     if (isExpired(url, genAt, now)) { skipped.push({ index: i, label, file: null, url, reason: "expired" }); return null; }
     const retry = await fetchAssetBlob(url, { fetchImpl, timeoutMs: 15000 });
     if (!retry.blob) {
       const first = cached ? cached.error : "not prefetched";
       skipped.push({ index: i, label, file: null, url, reason: "fetch-failed: " + first + "; " + retry.error });
       return null;
     }
     blob = retry.blob;
   }
   const bytes = new Uint8Array(await blob.arrayBuffer());
   const format = detectImageFormat(bytes);
   const file = "images/" + sceneFileStem(i) + "." + (EXT[format] || "bin");
   return { index: i, position: i + 1, sceneNumber: n, bytes, format, file, url, s3Key: (imgs[i] && imgs[i].s3Key) || null };
 }));
 skipped.sort((a, b) => a.index - b.index);

 let videoAsset = null;
 const vCache = cache && cache.video;
 const vUrl = videoUrl || (vCache && vCache.url) || null;
 const requested = !!(videoState && videoState.requested) || !!vUrl;
 if (requested) {
   const label = "Video";
   if (vCache && vCache.blob) {
     videoAsset = { bytes: new Uint8Array(await vCache.blob.arrayBuffer()), file: "video.mp4", url: vUrl };
   } else if (vUrl) {
     const prefetch = vCache && vCache.kind ? vCache : null;
     if (isExpired(vUrl, (vCache && vCache.readyAt) || genAt, now)) {
       // No retry possible; report the prefetch's real cause if it had one
       // (a CORS block must not be relabelled as an expired link).
       const known = prefetch && (prefetch.kind === "network" || prefetch.kind === "http");
       skipped.push({ label, file: null, url: vUrl, reason: known ? videoFailureReason(null, prefetch) : "expired" });
     } else {
       const retry = await fetchAssetBlob(vUrl, { fetchImpl, timeoutMs: 15000 });
       if (retry.blob) videoAsset = { bytes: new Uint8Array(await retry.blob.arrayBuffer()), file: "video.mp4", url: vUrl };
       else skipped.push({ label, file: null, url: vUrl, reason: videoFailureReason(retry, prefetch) });
     }
   } else if (videoState && videoState.error) {
     skipped.push({ label, file: null, url: null, reason: "video-not-generated: " + videoState.error });
   } else {
     skipped.push({ label, file: null, url: null, reason: "video-still-generating" });
   }
 }
 return { imageAssets, videoAsset, skipped };
}

export function buildScriptMarkdown(script) {
 const s = script || {};
 const out = ["# " + (s.title || "Untitled Pitch"), ""];
 if (s.logline) out.push("> " + s.logline, "");
 if (s.genre) out.push("**Genre:** " + s.genre, "");
 const chars = Array.isArray(s.characters) ? s.characters : [];
 if (chars.length) {
   out.push("## Characters", "");
   chars.forEach(c => out.push("- **" + (c.name || "Unnamed") + "**" + (c.gender ? " (" + c.gender + ")" : "") + (c.appearance ? ": " + c.appearance : "")));
   out.push("");
 }
 const scenes = Array.isArray(s.scenes) ? s.scenes : [];
 scenes.forEach((sc, i) => {
   out.push("## Scene " + sceneNum(sc, i) + (sc.heading ? " - " + sc.heading : ""), "");
   if (sc.mood) out.push("*Mood:* " + sc.mood, "");
   if (sc.description) out.push(sc.description, "");
   (Array.isArray(sc.dialogue) ? sc.dialogue : []).forEach(d => out.push("**" + (d.character || "").toUpperCase() + ":** " + (d.line || ""), ""));
 });
 return out.join("\n");
}

export function buildReadme({ script, baseName, imageAssets, videoAsset, skipped, now = Date.now() }) {
 const lines = [
   (script && script.title) || "Untitled Pitch",
   "Exported from Micro Drama Pitcher on " + new Date(now).toISOString(),
   "",
   "Contents:",
   "  pitch.json      - raw script and image metadata",
   "  script.md       - screenplay in Markdown",
   "  pitch-deck.pdf  - PDF pitch deck (same as " + baseName + ".pdf)",
 ];
 imageAssets.filter(Boolean).forEach(a => lines.push("  " + a.file));
 if (videoAsset) lines.push("  " + videoAsset.file);
 lines.push("  README.txt      - this file", "");
 if (skipped.length) {
   lines.push("Skipped assets:");
   skipped.forEach(s => {
     lines.push("  - " + s.label + ": " + describeReason(s.reason));
     if (s.url) lines.push("    Original URL: " + shortUrl(s.url));
   });
   if (skipped.some(s => isExpiryReason(s.reason))) lines.push("", EXPIRY_ADVICE);
 } else {
   lines.push("All assets included.");
 }
 return lines.join("\n") + "\n";
}

// ---------- PDF deck ----------
const PAGE_W = 792, PAGE_H = 612, M = 48;
const IMG_W = 560, IMG_H = 315;
const DARK = "#0d0d0d", GOLD = "#ffd200", DARK_GOLD = "#b8860b", INK = "#1a1a1a", GREY = "#555555";

export function buildPdf(script, imageAssets) {
 const s = script || {};
 const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
 const contentW = PAGE_W - 2 * M;
 const bottom = PAGE_H - M - 12;
 let y = M;
 let contHeader = null;

 const newPage = () => {
   doc.addPage();
   y = M;
   if (contHeader) {
     doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(DARK_GOLD);
     doc.text(pdfSafe(contHeader), M, y + 12);
     y += 28;
   }
 };
 const ensure = (h) => { if (y + h > bottom) newPage(); };
 const para = (text, { font = "helvetica", style = "normal", size = 11, color = INK, x = M, width = contentW, gap = 6 } = {}) => {
   if (!text) return;
   doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor(color);
   const lh = size * 1.35;
   doc.splitTextToSize(pdfSafe(text), width).forEach(line => {
     ensure(lh);
     doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor(color);
     doc.text(line, x, y + size);
     y += lh;
   });
   y += gap;
 };
 const rule = () => { doc.setDrawColor(DARK_GOLD); doc.setLineWidth(1.5); doc.line(M, y, PAGE_W - M, y); y += 14; };

 // Title page: the one cinematic dark page.
 doc.setFillColor(DARK); doc.rect(0, 0, PAGE_W, PAGE_H, "F");
 doc.setFont("helvetica", "bold"); doc.setFontSize(40); doc.setTextColor(GOLD);
 const titleLines = doc.splitTextToSize(pdfSafe(s.title || "Untitled Pitch"), PAGE_W - 144);
 let ty = 200;
 titleLines.forEach(l => { doc.text(l, PAGE_W / 2, ty, { align: "center" }); ty += 48; });
 doc.setDrawColor(GOLD); doc.setLineWidth(1); doc.line(PAGE_W / 2 - 80, ty - 18, PAGE_W / 2 + 80, ty - 18);
 ty += 12;
 if (s.logline) {
   doc.setFont("helvetica", "italic"); doc.setFontSize(16); doc.setTextColor("#cccccc");
   doc.splitTextToSize(pdfSafe(s.logline), PAGE_W - 200).forEach(l => { doc.text(l, PAGE_W / 2, ty, { align: "center" }); ty += 22; });
 }
 if (s.genre) {
   ty += 18;
   doc.setFont("helvetica", "bold"); doc.setFontSize(12);
   const g = pdfSafe(String(s.genre).toUpperCase());
   const gw = doc.getTextWidth(g) + 28;
   doc.setDrawColor(GOLD); doc.roundedRect(PAGE_W / 2 - gw / 2, ty - 14, gw, 22, 11, 11, "S");
   doc.setTextColor(GOLD); doc.text(g, PAGE_W / 2, ty + 1, { align: "center" });
 }
 doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor("#888888");
 doc.text("Micro Drama Pitcher", PAGE_W / 2, PAGE_H - 40, { align: "center" });

 // Characters page.
 const chars = Array.isArray(s.characters) ? s.characters : [];
 contHeader = "Characters (cont.)";
 doc.addPage(); y = M;
 doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(INK);
 doc.text("Characters", M, y + 24); y += 36; rule();
 if (!chars.length) para("No characters listed.", { color: GREY });
 chars.forEach(c => {
   ensure(40);
   doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(DARK_GOLD);
   const name = pdfSafe(c.name || "Unnamed");
   doc.text(name, M, y + 14);
   if (c.gender) {
     const nw = doc.getTextWidth(name);
     doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(GREY);
     doc.text(pdfSafe("(" + c.gender + ")"), M + nw + 8, y + 14);
   }
   y += 20;
   para(c.appearance, { size: 11, gap: 12 });
 });

 // One section per scene.
 const scenes = Array.isArray(s.scenes) ? s.scenes : [];
 scenes.forEach((sc, i) => {
   const n = sceneNum(sc, i);
   contHeader = null;
   doc.addPage(); y = M;
   contHeader = "Scene " + n + " (cont.)";
   doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(DARK_GOLD);
   doc.text(pdfSafe("Scene " + n), M, y + 20); y += 28;
   if (sc.heading) para(sc.heading, { font: "courier", style: "bold", size: 12, color: INK, gap: 2 });
   rule();

   // 16:9 image box, image contain-fitted and centered.
   const bx = (PAGE_W - IMG_W) / 2, by = y;
   const asset = imageAssets && imageAssets[i];
   let drawn = false;
   if (asset && (asset.format === "PNG" || asset.format === "JPEG")) {
     try {
       const dataUrl = "data:image/" + asset.format.toLowerCase() + ";base64," + bytesToBase64(asset.bytes);
       const props = doc.getImageProperties(dataUrl);
       const k = Math.min(IMG_W / props.width, IMG_H / props.height);
       const w = props.width * k, h = props.height * k;
       doc.setFillColor(DARK); doc.rect(bx, by, IMG_W, IMG_H, "F");
       doc.addImage(dataUrl, asset.format, bx + (IMG_W - w) / 2, by + (IMG_H - h) / 2, w, h);
       drawn = true;
     } catch { drawn = false; }
   }
   if (!drawn) {
     doc.setFillColor("#f2f2f2"); doc.setDrawColor("#bbbbbb"); doc.setLineWidth(1);
     doc.rect(bx, by, IMG_W, IMG_H, "FD");
     doc.setFont("helvetica", "italic"); doc.setFontSize(14); doc.setTextColor("#888888");
     doc.text("Image unavailable", PAGE_W / 2, by + IMG_H / 2, { align: "center" });
   }
   y = by + IMG_H + 14;

   if (sc.mood) para("Mood: " + sc.mood, { style: "italic", size: 11, color: GREY, gap: 4 });
   para(sc.description, { size: 11, gap: 8 });
   (Array.isArray(sc.dialogue) ? sc.dialogue : []).forEach(d => {
     const name = pdfSafe((d.character || "").toUpperCase() + ":");
     doc.setFont("helvetica", "bold"); doc.setFontSize(11);
     const nw = Math.min(doc.getTextWidth(name) + 6, contentW / 3);
     doc.setFont("helvetica", "normal");
     const lines = doc.splitTextToSize(pdfSafe(d.line || ""), contentW - nw);
     lines.forEach((line, li) => {
       ensure(15);
       if (li === 0) {
         doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(DARK_GOLD);
         doc.text(name, M, y + 11);
       }
       doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(INK);
       doc.text(line, M + nw, y + 11);
       y += 15;
     });
     y += 4;
   });
 });

 // Page numbers.
 const total = doc.getNumberOfPages();
 for (let p = 1; p <= total; p++) {
   doc.setPage(p);
   doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(p === 1 ? "#888888" : GREY);
   doc.text(p + " / " + total, PAGE_W - M, PAGE_H - 24, { align: "right" });
 }
 return new Uint8Array(doc.output("arraybuffer"));
}

// ---------- ZIP bundle ----------
export async function buildZip({ script, images, imageAssets, videoAsset, skipped, pdfBytes, generatedAt, baseName, now = Date.now() }) {
 const zip = new JSZip();
 const imgs = Array.isArray(images) ? images : [];
 const scenes = (script && Array.isArray(script.scenes)) ? script.scenes : [];
 const skipFor = (i) => skipped.find(s => s.index === i);
 const videoSkip = skipped.find(s => s.label === "Video");
 const meta = {
   exportedAt: new Date(now).toISOString(),
   generatedAt: generatedAt != null ? new Date(generatedAt).toISOString() : null,
   script,
   images: scenes.map((sc, i) => {
     const a = imageAssets[i], sk = skipFor(i);
     return {
       position: i + 1,
       sceneNumber: sceneNum(sc, i),
       file: a ? a.file : null,
       status: a ? "included" : "skipped",
       reason: sk ? sk.reason : null,
       s3Key: (imgs[i] && imgs[i].s3Key) || null,
       originalUrl: shortUrl(getImageUrl(imgs[i])),
     };
   }),
   video: videoAsset
     ? { file: videoAsset.file, status: "included", reason: null, originalUrl: videoAsset.url }
     : videoSkip ? { file: null, status: "skipped", reason: videoSkip.reason, originalUrl: videoSkip.url } : null,
 };
 zip.file("pitch.json", JSON.stringify(meta, null, 2));
 zip.file("script.md", buildScriptMarkdown(script));
 imageAssets.filter(Boolean).forEach(a => zip.file(a.file, a.bytes, { compression: "STORE" }));
 zip.file("pitch-deck.pdf", pdfBytes);
 if (videoAsset) zip.file(videoAsset.file, videoAsset.bytes, { compression: "STORE" });
 zip.file("README.txt", buildReadme({ script, baseName, imageAssets, videoAsset, skipped, now }));
 return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// On-screen status text shown after an export.
export function buildExportMessage(pkg, kind, fileName) {
 let msg = "Exported " + fileName + ".";
 if (pkg.skipped.length) {
   msg += " Skipped: " + pkg.skipped.map(s => s.label + " (" + describeReason(s.reason) + ")").join(", ") + ".";
   if (kind === "zip") msg += " See README.txt in the ZIP for the original links.";
 }
 if (pkg.expired) msg += " " + pkg.expiryAdvice;
 return msg;
}

export async function buildExportPackage(opts) {
 const { script, images, cache, only } = opts;
 const now = opts.now != null ? opts.now : Date.now();
 const generatedAt = opts.generatedAt != null ? opts.generatedAt : cache && cache.generatedAt;
 const baseName = slugify(script && script.title);
 // The PDF has no video, so a PDF-only export ignores it entirely.
 const ro = only === "pdf" ? { ...opts, videoUrl: null, videoState: null, cache: cache ? { ...cache, video: null } : cache } : opts;
 const { imageAssets, videoAsset, skipped } = await resolveAssets({ ...ro, generatedAt, now });
 const pdfBytes = buildPdf(script, imageAssets);
 const zipBytes = only === "pdf" ? undefined
   : await buildZip({ script, images, imageAssets, videoAsset, skipped, pdfBytes, generatedAt, baseName, now });
 return { baseName, zipBytes, pdfBytes, skipped, expired: skipped.some(s => isExpiryReason(s.reason)), expiryAdvice: EXPIRY_ADVICE };
}
