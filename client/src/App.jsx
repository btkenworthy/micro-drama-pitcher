import React, { useState, useRef, useEffect } from "react";
import { prefetchImages, prefetchVideo } from "./assetCache.js";

const API = "";

const styles = {
 app: { fontFamily: "'Segoe UI', sans-serif", background: "#0d0d0d", color: "#eee", minHeight: "100vh", padding: "2rem" },
 header: { textAlign: "center", marginBottom: "2rem" },
 title: { fontSize: "2.4rem", background: "linear-gradient(90deg, #f7971e, #ffd200)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
 subtitle: { color: "#888", marginTop: "0.3rem" },
 form: { display: "flex", gap: "0.5rem", maxWidth: 700, margin: "0 auto 2rem" },
 input: { flex: 1, padding: "0.8rem 1rem", borderRadius: 8, border: "1px solid #333", background: "#1a1a1a", color: "#eee", fontSize: "1rem" },
 btn: { padding: "0.8rem 1.6rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #f7971e, #ffd200)", color: "#111", fontWeight: 700, cursor: "pointer", fontSize: "1rem" },
 btnDisabled: { opacity: 0.5, cursor: "wait" },
 card: { background: "#1a1a1a", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem", maxWidth: 900, margin: "0 auto 1.5rem" },
 sceneImg: { width: "100%", borderRadius: 8, marginTop: "1rem" },
 dialogue: { margin: "0.5rem 0", paddingLeft: "1rem", borderLeft: "3px solid #ffd200" },
 charName: { color: "#ffd200", fontWeight: 700 },
 badge: { display: "inline-block", padding: "0.2rem 0.6rem", borderRadius: 20, background: "#333", fontSize: "0.8rem", marginRight: "0.5rem" },
 video: { width: "100%", borderRadius: 8, marginTop: "1rem" },
 spinner: { textAlign: "center", padding: "3rem", color: "#888", fontSize: "1.2rem" },
 checkbox: { display: "flex", alignItems: "center", gap: "0.4rem", justifyContent: "center", marginBottom: "1rem", color: "#888" },
 exportRow: { display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" },
 exportStatus: { color: "#aaa", fontSize: "0.9rem", marginBottom: 0, minHeight: "1.2em" },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Browser-only download glue for export bytes.
function downloadBytes(bytes, filename, type) {
 const url = URL.createObjectURL(new Blob([bytes], { type }));
 const a = document.createElement("a");
 a.href = url; a.download = filename;
 document.body.appendChild(a); a.click(); a.remove();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cacheText(info) {
 if (!info) return "";
 let t = info.done < info.total ? "Caching images for export: " + info.done + "/" + info.total + "..." : "Images cached for export (" + (info.total - info.failed) + "/" + info.total + ").";
 if (info.done >= info.total && info.failed > 0) t += " " + info.failed + " could not be cached and will be retried at export.";
 if (info.video === "caching") t += " Caching video...";
 if (info.video === "cached") t += " Video cached.";
 if (info.video === "failed") t += " Video could not be cached (will be retried at export).";
 return t;
}

export default function App() {
 const [prompt, setPrompt] = useState("");
 const [withVideo, setWithVideo] = useState(false);
 const [loading, setLoading] = useState(false);
 const [result, setResult] = useState(null);
 const [videoStatus, setVideoStatus] = useState(null);
 const [videoUrl, setVideoUrl] = useState(null);
 const [videoError, setVideoError] = useState(null);
 const [error, setError] = useState("");
 const [cacheInfo, setCacheInfo] = useState(null);
 const [exporting, setExporting] = useState(null);
 const [exportMsg, setExportMsg] = useState("");
 const [exportError, setExportError] = useState("");
 // Per-pitch in-memory asset cache (Blobs), so export survives presigned URL expiry.
 const genIdRef = useRef(0);
 const cacheRef = useRef(null);
 const exportBusyRef = useRef(false);

 useEffect(() => () => { cacheRef.current = null; }, []);

 const pollVideo = async (invocationArn, bucket, key, genId) => {
   setVideoStatus("Generating video...");
   for (let i = 0; i < 60; i++) {
     await sleep(10000);
     if (genIdRef.current !== genId) return; // a newer pitch was generated
     const res = await fetch(API + "/api/video/status", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ invocationArn, bucket, key }),
     });
     const data = await res.json();
     if (genIdRef.current !== genId) return;
     setVideoStatus("Video: " + data.status + "...");
     if (data.status === "Completed") {
       setVideoUrl(data.videoUrl); setVideoStatus(null);
       const cache = cacheRef.current;
       if (cache && cache.genId === genId) {
         setCacheInfo(ci => ci && Object.assign({}, ci, { video: "caching" }));
         cache.videoPromise = prefetchVideo(data.videoUrl).then(v => {
           cache.video = v;
           if (genIdRef.current === genId) setCacheInfo(ci => ci && Object.assign({}, ci, { video: v.blob ? "cached" : "failed" }));
           return v;
         });
       }
       return;
     }
     if (data.status === "Failed") { setVideoError(data.failureMessage || "Failed"); setVideoStatus(null); return; }
   }
   if (genIdRef.current !== genId) return;
   setVideoError("Timed out");
   setVideoStatus(null);
 };

 const handleGenerate = async (e) => {
   e.preventDefault();
   if (prompt.trim() === "") return;
   const genId = ++genIdRef.current;
   cacheRef.current = null;
   setLoading(true); setError(""); setResult(null); setVideoUrl(null); setVideoError(null); setVideoStatus(null);
   setCacheInfo(null); setExportMsg(""); setExportError("");
   try {
     const res = await fetch(API + "/api/generate", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ prompt }),
     });
     if (res.ok === false) throw new Error((await res.json()).error || "Generation failed");
     const data = await res.json();
     if (genIdRef.current !== genId) return;
     setResult(data);
     // Prefetch every scene image into memory right away (presigned URLs expire in 1 hour).
     const cache = { genId, generatedAt: Date.now(), withVideo, images: null, video: null, videoStartError: null };
     cacheRef.current = cache;
     cache.imagesPromise = prefetchImages(data.images, {
       onProgress: (p) => { if (genIdRef.current === genId) setCacheInfo(ci => Object.assign({}, ci, p)); },
     }).then(arr => { cache.images = arr; return arr; });
     if (withVideo && data.script && data.script.scenes && data.script.scenes.length > 0) {
       const scene = data.script.scenes[0];
       const vRes = await fetch(API + "/api/video/start", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ prompt: scene.visualPrompt || scene.description }),
       });
       const vData = await vRes.json();
       if (vData.invocationArn) pollVideo(vData.invocationArn, vData.bucket, vData.key, genId);
       else cache.videoStartError = vData.error || "video did not start";
     }
   } catch (err) { if (genIdRef.current === genId) setError(err.message); } finally { if (genIdRef.current === genId) setLoading(false); }
 };

 const handleExport = async (kind) => {
   // Buttons stay focusable while busy (aria-disabled, not disabled), so guard here.
   if (exportBusyRef.current || !result) return;
   exportBusyRef.current = true;
   const cache = cacheRef.current;
   setExporting(kind); setExportError(""); setExportMsg(kind === "zip" ? "Building ZIP..." : "Building PDF...");
   try {
     // Wait for any in-flight prefetch so the export uses cached blobs.
     if (cache && cache.imagesPromise) await cache.imagesPromise;
     if (kind === "zip" && cache && cache.videoPromise) await cache.videoPromise;
     const m = await import("./exportPackage.js");
     const pkg = await m.buildExportPackage({
       script: result.script,
       images: result.images,
       cache,
       videoUrl,
       videoState: { requested: !!(cache && cache.withVideo), error: videoError || (cache && cache.videoStartError) },
       generatedAt: cache ? cache.generatedAt : undefined,
       only: kind === "pdf" ? "pdf" : undefined,
     });
     if (cacheRef.current !== cache) return; // a newer pitch replaced this one
     const fileName = pkg.baseName + (kind === "zip" ? ".zip" : ".pdf");
     if (kind === "zip") downloadBytes(pkg.zipBytes, fileName, "application/zip");
     else downloadBytes(pkg.pdfBytes, fileName, "application/pdf");
     setExportMsg(m.buildExportMessage(pkg, kind, fileName));
   } catch (err) {
     setExportMsg("");
     setExportError("Export failed: " + ((err && err.message) || String(err)));
   } finally { exportBusyRef.current = false; setExporting(null); }
 };

 const script = result ? result.script : null;
 const images = result ? result.images : null;

 return (
   <div style={styles.app}>
     <header style={styles.header}>
       <h1 style={styles.title}>Micro Drama Pitcher</h1>
       <p style={styles.subtitle}>Turn your idea into a pitch-ready micro drama with AI</p>
     </header>
     <form onSubmit={handleGenerate} style={styles.form}>
       <input style={styles.input} placeholder="Describe your micro drama idea..." value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Drama idea prompt" />
       <button style={Object.assign({}, styles.btn, loading ? styles.btnDisabled : {})} disabled={loading}>{loading ? "Generating..." : "Generate Pitch"}</button>
     </form>
     <label style={styles.checkbox}>
       <input type="checkbox" checked={withVideo} onChange={(e) => setWithVideo(e.target.checked)} />
       Also generate video (Nova Reel - takes a few minutes)
     </label>
     {loading && <div style={styles.spinner}>Crafting your micro drama pitch...</div>}
     {error && <div style={Object.assign({}, styles.card, {borderLeft: "3px solid #e74c3c"})}>Error: {error}</div>}
     {script && (<>
       <div style={Object.assign({}, styles.card, {textAlign: "center"})}>
         <h2 style={{color: "#ffd200", margin: 0}}>{script.title}</h2>
         <p style={{color: "#aaa", fontStyle: "italic"}}>{script.logline}</p>
         <span style={styles.badge}>{script.genre}</span>
       </div>
       <section style={Object.assign({}, styles.card, {textAlign: "center"})} aria-labelledby="export-heading">
         <h3 id="export-heading" style={{color: "#ffd200", marginTop: 0}}>Export Pitch Package</h3>
         <div style={styles.exportRow}>
           <button type="button" onClick={() => handleExport("zip")} aria-disabled={!!exporting} aria-busy={exporting === "zip"} aria-describedby="export-status" style={Object.assign({}, styles.btn, exporting ? styles.btnDisabled : {})}>{exporting === "zip" ? "Building ZIP..." : "Download ZIP"}</button>
           <button type="button" onClick={() => handleExport("pdf")} aria-disabled={!!exporting} aria-busy={exporting === "pdf"} aria-describedby="export-status" style={Object.assign({}, styles.btn, exporting ? styles.btnDisabled : {})}>{exporting === "pdf" ? "Building PDF..." : "Download PDF"}</button>
         </div>
         <p id="export-status" role="status" aria-live="polite" style={styles.exportStatus}>{exportMsg || cacheText(cacheInfo)}</p>
         {exportError && <div role="alert" style={{borderLeft: "3px solid #e74c3c", paddingLeft: "0.8rem", marginTop: "0.8rem", textAlign: "left"}}>{exportError}</div>}
       </section>
       {script.scenes && script.scenes.map((scene, i) => (
         <div key={i} style={styles.card}>
           <h3 style={{color: "#ffd200", marginTop: 0}}>Scene {scene.sceneNumber}</h3>
           <p style={{color: "#999", fontFamily: "monospace", fontSize: "0.85rem"}}>{scene.heading}</p>
           <p>{scene.description}</p>
           <span style={styles.badge}>Mood: {scene.mood}</span>
           {scene.dialogue && scene.dialogue.map((d, j) => (<div key={j} style={styles.dialogue}><span style={styles.charName}>{d.character}:</span> {d.line}</div>))}
           {images && images[i] && <img src={images[i].url || images[i]} alt={"Scene " + scene.sceneNumber} style={styles.sceneImg} />}
         </div>
       ))}
       {videoStatus && <div style={styles.spinner}>{videoStatus}</div>}
       {videoError && <div style={Object.assign({}, styles.card, {borderLeft: "3px solid #e74c3c"})}>Video: {videoError}</div>}
       {videoUrl && (<div style={styles.card}><h3 style={{color: "#ffd200"}}>Generated Video</h3><video controls style={styles.video}><source src={videoUrl} type="video/mp4" /></video></div>)}
     </>)}
   </div>
 );
}
