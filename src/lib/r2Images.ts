/**
 * src/lib/r2Images.ts
 *
 * R2 image helpers — list & URL construction for step images.
 *
 * Naming convention (from StepImageUploadModal):
 *   step-images/{stepId}_{serialNo}_{N}.ext
 *   odd  N → action image
 *   even N → expected-result image
 *
 * Worker contract assumed:
 *   POST { type: "list",   prefix: string }        → { keys: string[] }
 *   GET  ?key={encodedKey}                         → image bytes (public, no auth)
 */

export const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev"
const IMAGE_PREFIX = "step-images"
const IMAGE_CACHE_TTL_MS = 30 * 60 * 1_000 // 30 min — images don't change during a session

export type StepImageUrls = {
  actionUrls:   string[]
  expectedUrls: string[]
}

// ── In-memory cache (same pattern as r2.ts) ─────────────────────────────────

interface CacheEntry {
  data: unknown
  ts: number
  ttl: number
}

const _cache = new Map<string, CacheEntry>()

async function cachedList<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < hit.ttl) return hit.data as T

  const data = await fetcher()
  _cache.set(key, { data, ts: Date.now(), ttl })
  return data
}

/**
 * Force-invalidate a single image list cache entry.
 * Call after an image upload/delete to ensure the next read is fresh.
 */
export function r2ImageInvalidate(stepId: string, serialNo: number): void {
  const cacheKey = `${IMAGE_PREFIX}/${stepId}_${serialNo}_`
  _cache.delete(cacheKey)
}

/**
 * Invalidate all cached image list entries.
 * Call after bulk upload or when the user triggers a manual refresh.
 */
export function r2ImageInvalidateAll(): void {
  _cache.clear()
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Public image URL — worker handles GET ?key=… without auth.
 */
export function r2ImageUrl(key: string): string {
  return `${WORKER_URL}?key=${encodeURIComponent(key)}`
}

/**
 * List all image keys for one step and split by odd/even index.
 * Keys are sorted numerically so images always come out in upload order.
 * Cached 30 min — step images are immutable once uploaded.
 */
export async function r2ListStepImages(
  token:    string,
  stepId:   string,
  serialNo: number,
): Promise<StepImageUrls> {
  const prefix = `${IMAGE_PREFIX}/${stepId}_${serialNo}_`

  return cachedList<StepImageUrls>(prefix, IMAGE_CACHE_TTL_MS, async () => {
    const res = await fetch(WORKER_URL, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ type: "list", prefix }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as any).error ?? `Worker list ${res.status}`)
    }

    const { keys = [] } = (await res.json()) as { keys: string[] }

    const sorted = [...keys].sort((a, b) => extractN(a) - extractN(b))

    const actionUrls:   string[] = []
    const expectedUrls: string[] = []

    for (const key of sorted) {
      const n = extractN(key)
      if (n === -1) continue
      ;(n % 2 === 1 ? actionUrls : expectedUrls).push(r2ImageUrl(key))
    }

    return { actionUrls, expectedUrls }
  })
}

/** Extract the numeric N suffix from `…_N.ext`. Returns -1 on failure. */
function extractN(key: string): number {
  const m = key.match(/_(\d+)\.[^._]+$/)
  return m ? parseInt(m[1], 10) : -1
}