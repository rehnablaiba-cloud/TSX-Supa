import { useEffect } from "react";

// Releases a testlock row when the user closes/refreshes the tab.
// Uses fetch with keepalive so the request fires even during beforeunload.
// The REST filter matches on module_test_id + user_id so only the owner's
// lock is removed (RLS also enforces this server-side).

const useReleaseLockOnUnload = (moduleTestId: string, userId: string) => {
  useEffect(() => {
    if (!moduleTestId || !userId) return;

    const releaseLock = () => {
      fetch(
        // ✅ Fixed: column is module_test_id, not test_id
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/testlocks` +
        `?module_test_id=eq.${moduleTestId}&user_id=eq.${userId}`,
        {
          method:    "DELETE",
          keepalive: true,
          headers: {
            "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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