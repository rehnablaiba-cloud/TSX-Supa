import { useEffect } from "react";
import { supabase } from "../supabase";

// Releases a test_lock row when the user closes/refreshes the tab.
// Uses fetch with keepalive so the request fires even during beforeunload.

const useReleaseLockOnUnload = (moduleTestId: string, userId: string) => {
  useEffect(() => {
    if (!moduleTestId || !userId) return;

    let sessionToken: string | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionToken = session?.access_token ?? null;
    });

    const releaseLock = () => {
      if (!sessionToken) return;

      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/test_locks` +
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