// ─────────────────────────────────────────────────────────────────────────
// VIDEO MEDIA SYNC — Meta's video source URLs EXPIRE, so we never store or
// serve the URL. During the background sync (budgeted, resumable, never in a
// request) we resolve each video ad's creative -> video id -> video source,
// DOWNLOAD the high-res thumbnail and the playable video file into our own
// storage, and record the stored URLs on ad_creative_image, keyed by ad_id.
//
// Bounded by construction: a per-run wall-clock budget, a per-run total-bytes
// budget, and a per-file size cap. Active video ads are backfilled first, then
// the newest. Already-stored ads are skipped, so a re-run is cheap. Coverage is
// logged per run. A dead/oversized/permission-blocked source simply records a
// status and moves on; it never throws the sync.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS, firstEnv, normalizeAdAccountId } from "@/lib/creators";
import { startRun, finishRun, type Db } from "./db";

const GRAPH = "https://graph.facebook.com/v21.0";
const VIDEO_BUCKET = "ad-videos";
const THUMB_BUCKET = "ad-creatives";

const RUN_BUDGET_MS = 90_000; // never approach the function ceiling
const RUN_BYTES_BUDGET = 320 * 1024 * 1024; // total download per run
const MAX_VIDEO_BYTES = 45 * 1024 * 1024; // skip anything larger (rare)
const MAX_VIDEOS_PER_RUN = 40;

interface AdCreative {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    video_id?: string;
    thumbnail_url?: string;
    image_url?: string;
    object_story_spec?: { video_data?: { video_id?: string; image_url?: string } };
  };
}

// Buckets are made on first use rather than assumed to exist, so a brand new
// Supabase project works with no manual setup step. Remembered per process so
// this costs one listBuckets call, not one per file.
const bucketReady = new Set<string>();
async function ensureBucket(
  db: Db,
  name: string,
  opts: { allowedMimeTypes?: string[]; fileSizeLimit?: number },
) {
  if (bucketReady.has(name)) return;
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === name)) {
    const { error } = await db.storage.createBucket(name, { public: true, ...opts });
    if (error && !error.message.toLowerCase().includes("already")) {
      throw new Error(`create ${name}: ${error.message}`);
    }
  }
  bucketReady.add(name);
}

async function graphPage(url: string): Promise<{ data: AdCreative[]; next?: string }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Meta ads fetch ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: AdCreative[]; paging?: { next?: string } };
  return { data: json.data || [], next: json.paging?.next };
}

function videoIdOf(ad: AdCreative): string | null {
  return (
    ad.creative?.video_id ||
    ad.creative?.object_story_spec?.video_data?.video_id ||
    null
  );
}

async function resolveVideoSource(videoId: string, token: string): Promise<{ source?: string; picture?: string } | null> {
  try {
    const res = await fetch(`${GRAPH}/${videoId}?fields=source,picture&access_token=${token}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { source?: string; picture?: string };
  } catch {
    return null;
  }
}

interface MediaResult {
  clients: string[];
  videosStored: number;
  thumbsStored: number;
  scanned: number;
  skippedAlready: number;
  bytes: number;
  budgetHit: boolean;
  perClient: Record<string, { videoAds: number; stored: number }>;
}

export async function runMediaSync(now: Date = new Date()): Promise<MediaResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "media");
  const started = Date.now();
  const result: MediaResult = {
    clients: [],
    videosStored: 0,
    thumbsStored: 0,
    scanned: 0,
    skippedAlready: 0,
    bytes: 0,
    budgetHit: false,
    perClient: {},
  };

  try {
    for (const creator of ACTIVE_CREATORS) {
      const token = firstEnv(creator.tokenEnv);
      const account = firstEnv(creator.adAccountEnv);
      if (!token || !account) continue;
      result.clients.push(creator.key);
      result.perClient[creator.key] = { videoAds: 0, stored: 0 };

      // Which of this client's ads already have a stored video (skip those).
      const { data: storedRows } = await db
        .from("ad_creative_image")
        .select("ad_id")
        .eq("client_key", creator.key)
        .not("stored_video_url", "is", null);
      const alreadyStored = new Set((storedRows || []).map((r: { ad_id: string }) => r.ad_id));

      const acct = normalizeAdAccountId(account);
      const fields =
        "id,name,effective_status,creative{id,video_id,thumbnail_url,image_url,object_story_spec{video_data{video_id,image_url}}}";
      // Active ads first (backfill priority), then everything (newest-first per
      // Meta's default order).
      const passes = [
        `${GRAPH}/${acct}/ads?fields=${fields}&effective_status=["ACTIVE"]&limit=200&access_token=${token}`,
        `${GRAPH}/${acct}/ads?fields=${fields}&limit=200&access_token=${token}`,
      ];

      for (const startUrl of passes) {
        let url: string | undefined = startUrl;
        for (let page = 0; page < 20 && url; page++) {
          if (Date.now() - started > RUN_BUDGET_MS || result.bytes > RUN_BYTES_BUDGET) {
            result.budgetHit = true;
            break;
          }
          let pageData: { data: AdCreative[]; next?: string };
          try {
            pageData = await graphPage(url);
          } catch {
            break; // this pass failed for this client; move on
          }
          for (const ad of pageData.data) {
            const vid = videoIdOf(ad);
            if (!vid) continue;
            result.perClient[creator.key].videoAds += 1;
            if (alreadyStored.has(ad.id)) {
              result.skippedAlready += 1;
              continue;
            }
            if (
              result.videosStored >= MAX_VIDEOS_PER_RUN ||
              Date.now() - started > RUN_BUDGET_MS ||
              result.bytes > RUN_BYTES_BUDGET
            ) {
              result.budgetHit = true;
              break;
            }
            result.scanned += 1;
            await storeOneVideoAd(db, creator.key, ad, vid, token, result);
            alreadyStored.add(ad.id);
          }
          if (result.budgetHit) break;
          url = pageData.next;
        }
        if (result.budgetHit) break;
      }
      if (result.budgetHit) break;
    }

    await finishRun(db, runId, {
      status: "ok",
      rows: result.videosStored,
      durationMs: Date.now() - started,
      detail: result,
    });
    return result;
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function storeOneVideoAd(
  db: Db,
  clientKey: string,
  ad: AdCreative,
  videoId: string,
  token: string,
  result: MediaResult,
): Promise<void> {
  const src = await resolveVideoSource(videoId, token);
  const thumbUrl = src?.picture || ad.creative?.thumbnail_url || ad.creative?.image_url || null;

  // High-res thumbnail (small, always try).
  let storedThumb: string | null = null;
  if (thumbUrl) storedThumb = await downloadThumb(db, ad.id, thumbUrl, result);

  // The playable video file (chunk-streamed with size guard).
  let storedVideo: string | null = null;
  let status = "no_source";
  if (src?.source) {
    const out = await downloadVideo(db, ad.id, src.source, result);
    storedVideo = out.url;
    status = out.status;
  }

  await db.from("ad_creative_image").upsert(
    {
      ad_id: ad.id,
      client_key: clientKey,
      is_video: true,
      video_id: videoId,
      stored_thumb_url: storedThumb,
      stored_video_url: storedVideo,
      media_synced_at: new Date().toISOString(),
      media_status: status,
    },
    { onConflict: "ad_id" },
  );
  if (storedVideo) {
    result.videosStored += 1;
    result.perClient[clientKey].stored += 1;
  }
  if (storedThumb) result.thumbsStored += 1;
}

async function downloadThumb(db: Db, adId: string, url: string, result: MediaResult): Promise<string | null> {
  try {
    await ensureBucket(db, THUMB_BUCKET, { fileSizeLimit: 5 * 1024 * 1024 });
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    const ext = ct.includes("png") ? "png" : "jpg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > 5 * 1024 * 1024) return null;
    result.bytes += buf.byteLength;
    const path = `${adId}-vthumb.${ext}`;
    const { error } = await db.storage.from(THUMB_BUCKET).upload(path, buf, {
      contentType: ct,
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) return null;
    return db.storage.from(THUMB_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

async function downloadVideo(
  db: Db,
  adId: string,
  url: string,
  result: MediaResult,
): Promise<{ url: string | null; status: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok || !res.body) return { url: null, status: `fetch_${res.status}` };
    // Reject oversized up front when the server declares a length.
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_VIDEO_BYTES) return { url: null, status: "too_large" };

    // Stream in chunks with a hard cap, so one bad file can never blow memory.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_VIDEO_BYTES) {
          await reader.cancel();
          return { url: null, status: "too_large" };
        }
        chunks.push(value);
      }
    }
    if (!total) return { url: null, status: "empty" };
    result.bytes += total;
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    await ensureBucket(db, VIDEO_BUCKET, {
      allowedMimeTypes: ["video/mp4"],
      fileSizeLimit: MAX_VIDEO_BYTES,
    });
    const path = `${adId}.mp4`;
    const { error } = await db.storage.from(VIDEO_BUCKET).upload(path, buf, {
      contentType: "video/mp4",
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) return { url: null, status: `upload_${error.message.slice(0, 40)}` };
    return { url: db.storage.from(VIDEO_BUCKET).getPublicUrl(path).data.publicUrl, status: "stored" };
  } catch {
    return { url: null, status: "error" };
  }
}
