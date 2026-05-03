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

export type StepImageUrls = {
  actionUrls:   string[]
  expectedUrls: string[]
}

/**
 * Public image URL — worker must handle GET ?key=… without auth.
 * Drop this if your worker uses a different read scheme (e.g. CDN domain).
 */
export function r2ImageUrl(key: string): string {
  return `${WORKER_URL}?key=${encodeURIComponent(key)}`
}

/**
 * List all image keys for one step and split by odd/even index.
 * Keys are sorted numerically so images always come out in upload order.
 */
export async function r2ListStepImages(
  token:    string,
  stepId:   string,
  serialNo: number,
): Promise<StepImageUrls> {
  const prefix = `${IMAGE_PREFIX}/${stepId}_${serialNo}_`

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
}

/** Extract the numeric N suffix from `…_N.ext`. Returns -1 on failure. */
function extractN(key: string): number {
  const m = key.match(/_(\d+)\.[^._]+$/)
  return m ? parseInt(m[1], 10) : -1
}