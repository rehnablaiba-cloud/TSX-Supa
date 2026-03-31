import { useEffect } from "react";

const useReleaseLockOnUnload = (testId: string, userId: string) => {
  useEffect(() => {
    if (!testId || !userId) return;

    const releaseLock = () => {
      // Use fetch with keepalive so it fires even on tab close
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/testlocks?test_id=eq.${testId}&user_id=eq.${userId}`,
        {
          method: "DELETE",
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
  }, [testId, userId]);
};

export default useReleaseLockOnUnload;