import React, { useState } from "react";

const API = "https://d41jrpg1x3.execute-api.us-west-2.amazonaws.com";

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
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default function App() {
 const [prompt, setPrompt] = useState("");
 const [withVideo, setWithVideo] = useState(false);
 const [loading, setLoading] = useState(false);
 const [result, setResult] = useState(null);
 const [videoStatus, setVideoStatus] = useState(null);
 const [videoUrl, setVideoUrl] = useState(null);
 const [videoError, setVideoError] = useState(null);
 const [error, setError] = useState("");

 const pollVideo = async (invocationArn, bucket, key) => {
   setVideoStatus("Generating video...");
   for (let i = 0; i < 60; i++) {
     await sleep(10000);
     const res = await fetch(API + "/api/video/status", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ invocationArn, bucket, key }),
     });
     const data = await res.json();
     setVideoStatus("Video: " + data.status + "...");
     if (data.status === "Completed") { setVideoUrl(data.videoUrl); setVideoStatus(null); return; }
     if (data.status === "Failed") { setVideoError(data.failureMessage || "Failed"); setVideoStatus(null); return; }
   }
   setVideoError("Timed out");
   setVideoStatus(null);
 };

 const handleGenerate = async (e) => {
   e.preventDefault();
   if (prompt.trim() === "") return;
   setLoading(true); setError(""); setResult(null); setVideoUrl(null); setVideoError(null); setVideoStatus(null);
   try {
     const res = await fetch(API + "/api/generate", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ prompt }),
     });
     if (res.ok === false) throw new Error((await res.json()).error || "Generation failed");
     const data = await res.json();
     setResult(data);
     if (withVideo && data.script && data.script.scenes && data.script.scenes.length > 0) {
       const scene = data.script.scenes[0];
       const vRes = await fetch(API + "/api/video/start", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ prompt: scene.visualPrompt || scene.description }),
       });
       const vData = await vRes.json();
       if (vData.invocationArn) pollVideo(vData.invocationArn, vData.bucket, vData.key);
     }
   } catch (err) { setError(err.message); } finally { setLoading(false); }
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
       Also generate video (Luma Ray v2 - takes a few minutes)
     </label>
     {loading && <div style={styles.spinner}>Crafting your micro drama pitch...</div>}
     {error && <div style={Object.assign({}, styles.card, {borderLeft: "3px solid #e74c3c"})}>Error: {error}</div>}
     {script && (<>
       <div style={Object.assign({}, styles.card, {textAlign: "center"})}>
         <h2 style={{color: "#ffd200", margin: 0}}>{script.title}</h2>
         <p style={{color: "#aaa", fontStyle: "italic"}}>{script.logline}</p>
         <span style={styles.badge}>{script.genre}</span>
       </div>
       {script.scenes && script.scenes.map((scene, i) => (
         <div key={i} style={styles.card}>
           <h3 style={{color: "#ffd200", marginTop: 0}}>Scene {scene.sceneNumber}</h3>
           <p style={{color: "#999", fontFamily: "monospace", fontSize: "0.85rem"}}>{scene.heading}</p>
           <p>{scene.description}</p>
           <span style={styles.badge}>Mood: {scene.mood}</span>
           {scene.dialogue && scene.dialogue.map((d, j) => (<div key={j} style={styles.dialogue}><span style={styles.charName}>{d.character}:</span> {d.line}</div>))}
           {images && images[i] && <img src={images[i]} alt={"Scene " + scene.sceneNumber} style={styles.sceneImg} />}
         </div>
       ))}
       {videoStatus && <div style={styles.spinner}>{videoStatus}</div>}
       {videoError && <div style={Object.assign({}, styles.card, {borderLeft: "3px solid #e74c3c"})}>Video: {videoError}</div>}
       {videoUrl && (<div style={styles.card}><h3 style={{color: "#ffd200"}}>Generated Video</h3><video controls style={styles.video}><source src={videoUrl} type="video/mp4" /></video></div>)}
     </>)}
   </div>
 );
}
