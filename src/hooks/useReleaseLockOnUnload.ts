import { useEffect } from "react";
import { supabase } from "../supabase";

// Releases a testlock row when the user closes/refreshes the tab.
// Uses fetch with keepalive so the request fires even during beforeunload.
// The REST filter matches on module_test_id + user_id so only the owner's
// lock is removed (RLS also enforces this server-side).
//
// FIX: Previously used the anon key as the Bearer token, which meant
// auth.uid() returned null on the server — the testlocks_delete_own RLS
// policy (user_id = auth.uid()) would always reject the delete.
// Now resolves the live session JWT at registration time and uses that,
// so auth.uid() correctly identifies the calling user.

const useReleaseLockOnUnload = (moduleTestId: string, userId: string) => {
  useEffect(() => {
    if (!moduleTestId || !userId) return;

    // Capture the session token at the time the effect runs.
    // beforeunload fires synchronously — we cannot await getSession() inside it.
    let sessionToken: string | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionToken = session?.access_token ?? null;
    });

    const releaseLock = () => {
      // If the session token wasn't resolved yet, fall back to anon key only
      // for the apikey header (still needed for routing), but use the cached
      // token as the Bearer so auth.uid() resolves correctly.
      // If sessionToken is still null (very fast close), the delete will fail
      // gracefully — the heartbeat expiry will clean up the lock eventually.
      if (!sessionToken) return;

      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/testlocks` +
        `?module_test_id=eq.${moduleTestId}&user_id=eq.${userId}`,
        {
          method:    "DELETE",
          keepalive: true,
          headers: {
            "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${sessionToken}`,
            "Content-Type":  "application/json",
          },
        }
      );
    };

    window.addEventListener("beforeunload", releaseLock);
    window.addEventListener("pagehide",     releaseLock); // iOS Safari

    return () => {
      window.removeEventListener("beforeunload", releaseLock);
      window.removeEventListener("pagehide",     releaseLock);
    };
  }, [moduleTestId, userId]);
};

export default useReleaseLockOnUnload;