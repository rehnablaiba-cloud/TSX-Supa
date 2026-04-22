import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";

const HEARTBEAT_MS = 30_000;

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

// ─── Debug types ─────────────────────────────────────────────────────────────
interface HeartbeatLog {
  time: string;
  status: "ok" | "error" | "pending";
  message: string;
}

// ─── Debug Widget ─────────────────────────────────────────────────────────────
const HeartbeatDebugWidget = ({
  logs,
  lockInfo,
}: {
  logs: HeartbeatLog[];
  lockInfo: { module_test_id: string; user_id: string } | null;
}) => {
  const [minimized, setMinimized] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        width: minimized ? "auto" : 340,
        fontFamily: "monospace",
        fontSize: 11,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid #333",
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#1a1a2e",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          borderBottom: "1px solid #333",
        }}
        onClick={() => setMinimized((p) => !p)}
      >
        <span style={{ color: "#7dd3fc", fontWeight: "bold" }}>
          💓 Heartbeat Debug
        </span>
        <span style={{ color: "#666" }}>{minimized ? "▲" : "▼"}</span>
      </div>

      {!minimized && (
        <div style={{ background: "#0f0f1a" }}>
          {/* Lock info */}
          <div
            style={{
              padding: "6px 10px",
              borderBottom: "1px solid #222",
              color: lockInfo ? "#4ade80" : "#f87171",
            }}
          >
            {lockInfo ? (
              <>
                <div>🔒 Active Lock</div>
                <div style={{ color: "#94a3b8", marginTop: 2 }}>
                  test: {lockInfo.module_test_id}
                </div>
                <div style={{ color: "#94a3b8" }}>
                  user: {lockInfo.user_id.slice(0, 8)}...
                </div>
              </>
            ) : (
              <div>🔓 No active lock</div>
            )}
          </div>

          {/* Logs */}
          <div
            style={{
              maxHeight: 200,
              overflowY: "auto",
              padding: "4px 0",
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: "#555", padding: "6px 10px" }}>
                No heartbeats yet...
              </div>
            ) : (
              [...logs].reverse().map((log, i) => (
                <div
                  key={i}
                  style={{
                    padding: "3px 10px",
                    borderBottom: "1px solid #1a1a1a",
                    color:
                      log.status === "ok"
                        ? "#4ade80"
                        : log.status === "error"
                        ? "#f87171"
                        : "#fbbf24",
                  }}
                >
                  <span style={{ color: "#475569" }}>{log.time} </span>
                  <span>
                    {log.status === "ok"
                      ? "✅"
                      : log.status === "error"
                      ? "❌"
                      : "⏳"}{" "}
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Interval indicator */}
          <div
            style={{
              padding: "4px 10px",
              borderTop: "1px solid #222",
              color: "#475569",
            }}
          >
            interval: {HEARTBEAT_MS / 1000}s
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Provider ─────────────────────────────────────────────────────────────────
export const ActiveLockProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockRef = useRef<{ module_test_id: string; user_id: string } | null>(
    null
  );
  const [debugLogs, setDebugLogs] = useState<HeartbeatLog[]>([]);
  const [debugLockInfo, setDebugLockInfo] = useState<{
    module_test_id: string;
    user_id: string;
  } | null>(null);

  const addLog = (status: HeartbeatLog["status"], message: string) => {
    const time = new Date().toLocaleTimeString();
    console.log(`[Heartbeat][${status}] ${time} — ${message}`);
    setDebugLogs((prev) => [...prev.slice(-49), { time, status, message }]);
  };

  const setActiveLock = (module_test_id: string, user_id: string) => {
    lockRef.current = { module_test_id, user_id };
    setDebugLockInfo({ module_test_id, user_id });

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);

    const beat = async () => {
      addLog("pending", "Sending heartbeat...");
      const { error } = await supabase.rpc("update_lock_heartbeat", {
        p_module_test_id: module_test_id,
        p_user_id: user_id,
      });
      if (error) {
        addLog("error", `RPC error: ${error.message}`);
      } else {
        addLog("ok", "last_heartbeat updated ✓");
      }
    };

    beat();
    heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);
  };

  const clearActiveLock = () => {
    lockRef.current = null;
    setDebugLockInfo(null);
    addLog("ok", "Lock cleared, heartbeat stopped");
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

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
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, []);

  return (
    <ActiveLockContext.Provider value={{ setActiveLock, clearActiveLock }}>
      {children}
      {/* Remove this widget once heartbeat is confirmed working */}
      <HeartbeatDebugWidget logs={debugLogs} lockInfo={debugLockInfo} />
    </ActiveLockContext.Provider>
  );
};

export const useActiveLock = () => useContext(ActiveLockContext);
