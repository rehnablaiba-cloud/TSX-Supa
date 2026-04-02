/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │   THEME EDITOR PASSWORD CONFIGURATION                           │
 * │   src/config/themeEditorConfig.ts                               │
 * │                                                                 │
 * │   ✏️  TO CHANGE THE PASSWORD:                                   │
 * │      1. Pick a new password string                              │
 * │      2. Generate its SHA-256 hash:                              │
 * │         • Browser:  crypto.subtle.digest(...)  (see below)      │
 * │         • Terminal: echo -n "yourpw" | sha256sum                │
 * │         • Online:   https://emn178.github.io/online-tools/sha256│
 * │      3. Replace THEME_EDITOR_PASSWORD_HASH below with the hash  │
 * │                                                                 │
 * │   ⚠️  This is frontend-only security — it prevents casual       │
 * │       access but is NOT a substitute for server-side auth.      │
 * │       The hash is visible in the JS bundle.                     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 *  Default password:  testpro2024
 *  SHA-256 of above:  85cd0307988ed86453fc10c33f497ff20aff0e5caa3f3b36ed151350cd017e5
 */

export const THEME_EDITOR_PASSWORD_HASH =
  "85cd0307988ed86453fc10c33f497ff20aff0e5caa3f3b36ed151350cd017e56";

/** Verify a candidate password against the stored hash. */
export async function verifyThemePassword(candidate: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(candidate);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex === THEME_EDITOR_PASSWORD_HASH;
}
