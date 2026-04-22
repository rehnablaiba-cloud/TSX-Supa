import { createContext, useContext, useEffect, useRef } from "react";
import { supabase } from "../supabase";

const HEARTBEAT_MS = 30_000;

// Synchronously readable token — no Promise needed inside beforeunload
let _cachedToken: string | null = null;
supabase.auth.onAuthStateChange((_e, s) => {
  _cachedToken = s?.access_token ?? null;
});
supabase.auth.getSession().then(({ data: { session } }) => {
  _cachedToken = session?.access_token ?? null;
});

interface ActiveLockContextValue {
  setActiveLock: (module_test_id: string, user_id: string) => void;
  clearActiveLock: () => void;
}

const ActiveLockContext = createContext<ActiveLockContextValue>({
  setActiveLock: () => {},
  clearActiveLock: () => {},
});

export const ActiveLockProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockRef = useRef<{ module_test_id: string; user_id: string } | null>(
    null
  );

  const setActiveLock = (module_test_id: string, user_id: string) => {
    lockRef.current = { module_test_id, user_id };

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);

    const beat = () => {
      Promise.resolve(
        supabase.rpc("update_lock_heartbeat", {
          p_module_test_id: module_test_id,
          p_user_id: user_id,
        })
      ).catch(() => {});
    };

    beat(); // immediate ping
    heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);
  };

  const clearActiveLock = () => {
    lockRef.current = null;
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  // Tab close / refresh — keepalive DELETE survives page death
  useEffect(() => {
    const onUnload = () => {
      const lock = lockRef.current;
      const token = _cachedToken;
      if (!lock || !token) return;

      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/test_locks` +
          `?module_test_id=eq.${lock.module_test_id}&user_id=eq.${lock.user_id}`,
        {
          method: "DELETE",
          keepalive: true,
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
        }
      );
    };

    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload); // iOS Safari
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, []);

  return (
    <ActiveLockContext.Provider value={{ setActiveLock, clearActiveLock }}>
      {children}
    </ActiveLockContext.Provider>
  );
};

export const useActiveLock = () => useContext(ActiveLockContext);
