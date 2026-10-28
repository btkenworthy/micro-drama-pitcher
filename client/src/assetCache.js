// Prefetch helpers for export. Scene images (and the video) are fetched into
// in-memory Blobs as soon as they are available, because S3 presigned URLs
// expire after 1 hour. No DOM/React use so this also runs under Node.

export const PRESIGN_TTL_MS = 3600 * 1000;

// images[i] may be { url, s3Key }, a bare URL string, or null.
export function getImageUrl(entry) {
 if (!entry) return null;
 if (typeof entry === "string") return entry;
 return entry.url || null;
}

function timeoutSignal(ms) {
 if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) return AbortSignal.timeout(ms);
 return undefined;
}

// Never throws. Returns { blob, error, kind, status }.
// kind: null on success, else "http" (status set), "network" (fetch TypeError:
// CORS block or no connectivity), "timeout", "empty", "no-url" or "other".
export async function fetchAssetBlob(url, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
 if (!url) return { blob: null, error: "no URL", kind: "no-url", status: null };
 try {
   // no-store avoids reusing a non-CORS cached response from <img> (spurious S3 CORS failures)
   const res = await fetchImpl(url, { mode: "cors", credentials: "omit", cache: "no-store", signal: timeoutSignal(timeoutMs) });
   if (!res.ok) return { blob: null, error: "HTTP " + res.status, kind: "http", status: res.status };
   const blob = await res.blob();
   if (!blob || blob.size === 0) return { blob: null, error: "empty response", kind: "empty", status: res.status };
   return { blob, error: null, kind: null, status: res.status };
 } catch (err) {
   const msg = (err && err.message) || String(err);
   if (err && err.name === "TypeError") return { blob: null, error: "network/CORS error: " + msg, kind: "network", status: null };
   if (err && (err.name === "TimeoutError" || err.name === "AbortError")) return { blob: null, error: "timed out", kind: "timeout", status: null };
   return { blob: null, error: msg, kind: "other", status: null };
 }
}

// Magic-byte sniffing; MIME types from S3/data: URLs are not trusted.
export function detectImageFormat(bytes) {
 if (!bytes || bytes.length < 4) return null;
 if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "PNG";
 if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";
 if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
   bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "WEBP";
 return null;
}

async function sniffBlob(blob) {
 const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
 return detectImageFormat(head);
}

// Returns an array aligned with scenes: { url, blob, format, error } or null.
export async function prefetchImages(images, { fetchImpl = globalThis.fetch, onProgress } = {}) {
 const list = Array.isArray(images) ? images : [];
 const total = list.filter(e => getImageUrl(e)).length;
 let done = 0, failed = 0;
 if (onProgress) onProgress({ done, total, failed });
 return Promise.all(list.map(async (entry) => {
   const url = getImageUrl(entry);
   if (!url) return null;
   const { blob, error } = await fetchAssetBlob(url, { fetchImpl });
   const format = blob ? await sniffBlob(blob) : null;
   done++;
   if (!blob) failed++;
   if (onProgress) onProgress({ done, total, failed });
   return { url, blob, format, error };
 }));
}

// Best-effort: the us-east-1 video bucket may not allow CORS GET.
export async function prefetchVideo(url, { fetchImpl = globalThis.fetch } = {}) {
 const { blob, error, kind, status } = await fetchAssetBlob(url, { fetchImpl, timeoutMs: 120000 });
 return { url, blob, error, kind, status, readyAt: Date.now() };
}

export function isPresigned(url) {
 if (!url || url.startsWith("data:")) return false;
 try { return new URL(url).searchParams.has("X-Amz-Signature"); } catch { return false; }
}

// X-Amz-Date (yyyyMMddTHHmmssZ) + X-Amz-Expires seconds -> epoch ms, or null.
export function parsePresignedExpiry(url) {
 try {
   const p = new URL(url).searchParams;
   const d = p.get("X-Amz-Date"), e = Number(p.get("X-Amz-Expires"));
   const m = d && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(d);
   if (!m || !Number.isFinite(e)) return null;
   return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + e * 1000;
 } catch { return null; }
}

export function isExpired(url, generatedAt, now = Date.now()) {
 if (!isPresigned(url)) return false;
 const exp = parsePresignedExpiry(url);
 if (exp != null) return now >= exp;
 return generatedAt != null && now >= generatedAt + PRESIGN_TTL_MS;
}
