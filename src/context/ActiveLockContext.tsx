import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useAuth, updateLoggedIn } from "./AuthContext";

const HEARTBEAT_MS = 30_000;
const STALE_MS = 2 * 60 * 1000;

interface ActiveLockContextValue {
  setActiveLock: (module_test_id: string, user_id: string) => void;
  clearActiveLock: () => void;
}

const ActiveLockContext = createContext<ActiveLockContextValue>({
  setActiveLock: () => {},
  clearActiveLock: () => {},
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface SessionLog {
  time: string;
  category: "heartbeat" | "rehydrate" | "lock" | "system";
  status: "ok" | "error" | "pending" | "info" | "warn";
  message: string;
}

const CATEGORY_COLOR: Record<SessionLog["category"], string> = {
  heartbeat: "#7dd3fc",
  rehydrate: "#a78bfa",
  lock: "#4ade80",
  system: "#94a3b8",
};

const STATUS_ICON: Record<SessionLog["status"], string> = {
  ok: "✅",
  error: "❌",
  pending: "⏳",
  info: "ℹ️",
  warn: "⚠️",
};

// ─── Debug Widget ─────────────────────────────────────────────────────────────
const SessionDebugWidget = ({
  logs,
  lockInfo,
  nextBeat,
}: {
  logs: SessionLog[];
  lockInfo: { module_test_id: string; user_id: string } | null;
  nextBeat: number | null;
}) => {
  const [minimized, setMinimized] = useState(false);
  const [filter, setFilter] = useState<SessionLog["category"] | "all">("all");

  const filtered =
    filter === "all" ? logs : logs.filter((l) => l.category === filter);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        width: minimized ? "auto" : 380,
        fontFamily: "monospace",
        fontSize: 11,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid #2a2a3e",
        boxShadow: "0 4px 32px rgba(0,0,0,0.6)",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#12122a",
          padding: "7px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          borderBottom: "1px solid #2a2a3e",
        }}
        onClick={() => setMinimized((p) => !p)}
      >
        <span style={{ color: "#7dd3fc", fontWeight: "bold", fontSize: 12 }}>
          🛡️ Lock Session Monitor
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lockInfo && !minimized && (
            <span
              style={{
                background: "#4ade8020",
                color: "#4ade80",
                border: "1px solid #4ade8040",
                borderRadius: 99,
                padding: "1px 7px",
                fontSize: 10,
              }}
            >
              🔒 LOCKED
            </span>
          )}
          <span style={{ color: "#555" }}>{minimized ? "▲" : "▼"}</span>
        </div>
      </div>

      {!minimized && (
        <div style={{ background: "#0d0d1f" }}>
          {/* Lock info panel */}
          <div
            style={{
              padding: "8px 10px",
              borderBottom: "1px solid #1e1e32",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
            }}
          >
            <div>
              <div style={{ color: "#475569", fontSize: 10, marginBottom: 2 }}>
                STATUS
              </div>
              <div
                style={{
                  color: lockInfo ? "#4ade80" : "#f87171",
                  fontWeight: "bold",
                }}
              >
                {lockInfo ? "🔒 Active" : "🔓 No Lock"}
              </div>
            </div>
            <div>
              <div style={{ color: "#475569", fontSize: 10, marginBottom: 2 }}>
                NEXT HEARTBEAT
              </div>
              <div style={{ color: lockInfo ? "#fbbf24" : "#475569" }}>
                {lockInfo && nextBeat !== null ? `in ${nextBeat}s` : "—"}
              </div>
            </div>
            {lockInfo && (
              <>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div
                    style={{ color: "#475569", fontSize: 10, marginBottom: 2 }}
                  >
                    TEST
                  </div>
                  <div
                    style={{
                      color: "#e2e8f0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {lockInfo.module_test_id}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div
                    style={{ color: "#475569", fontSize: 10, marginBottom: 2 }}
                  >
                    USER ID
                  </div>
                  <div style={{ color: "#94a3b8" }}>
                    {lockInfo.user_id.slice(0, 12)}...
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Category filter tabs */}
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: "6px 8px",
              borderBottom: "1px solid #1e1e32",
              overflowX: "auto",
            }}
          >
            {(["all", "heartbeat", "rehydrate", "lock", "system"] as const).map(
              (cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 99,
                    border: "1px solid",
                    borderColor: filter === cat ? "#7dd3fc" : "#2a2a3e",
                    background: filter === cat ? "#7dd3fc15" : "transparent",
                    color: filter === cat ? "#7dd3fc" : "#475569",
                    cursor: "pointer",
                    fontSize: 10,
                    whiteSpace: "nowrap",
                  }}
                >
                  {cat === "all"
                    ? `all (${logs.length})`
                    : `${cat} (${
                        logs.filter((l) => l.category === cat).length
                      })`}
                </button>
              )
            )}
          </div>

          {/* Logs */}
          <div style={{ maxHeight: 220, overflowY: "auto", padding: "4px 0" }}>
            {filtered.length === 0 ? (
              <div style={{ color: "#374151", padding: "8px 10px" }}>
                No logs yet...
              </div>
            ) : (
              [...filtered].reverse().map((log, i) => (
                <div
                  key={i}
                  style={{
                    padding: "3px 10px",
                    borderBottom: "1px solid #0f0f1e",
                    display: "grid",
                    gridTemplateColumns: "68px 72px 1fr",
                    gap: 4,
                    alignItems: "start",
                  }}
                >
                  <span style={{ color: "#334155", fontSize: 10 }}>
                    {log.time}
                  </span>
                  <span
                    style={{
                      color: CATEGORY_COLOR[log.category],
                      fontSize: 10,
                    }}
                  >
                    [{log.category}]
                  </span>
                  <span
                    style={{
                      color:
                        log.status === "ok"
                          ? "#4ade80"
                          : log.status === "error"
                          ? "#f87171"
                          : log.status === "warn"
                          ? "#fbbf24"
                          : log.status === "pending"
                          ? "#fb923c"
                          : "#94a3b8",
                      wordBreak: "break-word",
                    }}
                  >
                    {STATUS_ICON[log.status]} {log.message}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "5px 10px",
              borderTop: "1px solid #1e1e32",
              display: "flex",
              justifyContent: "space-between",
              color: "#334155",
              fontSize: 10,
            }}
          >
            <span>heartbeat every {HEARTBEAT_MS / 1000}s</span>
            <span>stale after {STALE_MS / 1000}s</span>
            <span
              style={{ cursor: "pointer", color: "#475569" }}
              onClick={() =>
                console.table(
                  logs.map((l) => ({
                    time: l.time,
                    category: l.category,
                    status: l.status,
                    message: l.message,
                  }))
                )
              }
            >
              📋 dump
            </span>
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
  const { user } = useAuth();

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockRef = useRef<{ module_test_id: string; user_id: string } | null>(
    null
  );

  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [lockInfo, setLockInfo] = useState<{
    module_test_id: string;
    user_id: string;
  } | null>(null);
  const [nextBeat, setNextBeat] = useState<number | null>(null);

  const addLog = (
    category: SessionLog["category"],
    status: SessionLog["status"],
    message: string
  ) => {
    const time = new Date().toLocaleTimeString();
    console.log(`[${category.toUpperCase()}][${status}] ${time} — ${message}`);
    setLogs((prev) => [
      ...prev.slice(-99),
      { time, category, status, message },
    ]);
  };

  const startCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setNextBeat(HEARTBEAT_MS / 1000);
    countdownRef.current = setInterval(() => {
      setNextBeat((p) => {
        if (p === null) return null;
        if (p <= 1) return HEARTBEAT_MS / 1000;
        return p - 1;
      });
    }, 1000);
  };

  const startHeartbeat = (module_test_id: string, user_id: string) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);

    const beat = async () => {
      addLog("heartbeat", "pending", "Sending heartbeat...");
      const { error } = await supabase.rpc("update_lock_heartbeat", {
        p_module_test_id: module_test_id,
        p_user_id: user_id,
      });
      if (error) {
        addLog("heartbeat", "error", `RPC failed: ${error.message}`);
      } else {
        addLog(
          "heartbeat",
          "ok",
          "last_heartbeat updated ✓ — trigger cleaned stale locks"
        );
        // Refresh logged_in so login trigger stays active during test session
        await updateLoggedIn(user_id);
        addLog(
          "system",
          "info",
          "logged_in refreshed during active test session"
        );
      }
      startCountdown();
    };

    beat();
    heartbeatRef.current = setInterval(beat, HEARTBEAT_MS);
    addLog(
      "system",
      "info",
      `Heartbeat started — every ${HEARTBEAT_MS / 1000}s, stale threshold ${
        STALE_MS / 1000
      }s`
    );
  };

  const setActiveLock = (module_test_id: string, user_id: string) => {
    lockRef.current = { module_test_id, user_id };
    setLockInfo({ module_test_id, user_id });
    addLog("lock", "ok", `Lock acquired: ${module_test_id}`);
    startHeartbeat(module_test_id, user_id);
  };

  const clearActiveLock = () => {
    lockRef.current = null;
    setLockInfo(null);
    setNextBeat(null);
    addLog("lock", "warn", "Lock cleared — heartbeat stopped");
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  // ── Rehydrate on page load / refresh / crash ───────────────────────────────
  useEffect(() => {
    const rehydrate = async () => {
      addLog("rehydrate", "pending", "Checking session...");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        addLog("rehydrate", "warn", "No session — skipping rehydration");
        return;
      }

      addLog("rehydrate", "info", `Session: ${session.user.email}`);
      addLog("rehydrate", "pending", "Querying for active lock...");

      const { data, error } = await supabase
        .from("test_locks")
        .select("module_test_id, user_id, last_heartbeat")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) {
        addLog("rehydrate", "error", `Query failed: ${error.message}`);
        return;
      }

      if (data) {
        const age = Date.now() - new Date(data.last_heartbeat).getTime();
        addLog(
          "rehydrate",
          "info",
          `Lock found — last heartbeat ${Math.round(age / 1000)}s ago`
        );

        if (age > STALE_MS) {
          addLog(
            "rehydrate",
            "warn",
            "Lock is stale — skipping (login trigger will clean it)"
          );
        } else {
          addLog("rehydrate", "ok", `Resuming lock: ${data.module_test_id}`);
          lockRef.current = {
            module_test_id: data.module_test_id,
            user_id: data.user_id,
          };
          setLockInfo({
            module_test_id: data.module_test_id,
            user_id: data.user_id,
          });
          startHeartbeat(data.module_test_id, data.user_id);
        }
      } else {
        addLog("rehydrate", "ok", "No active lock — fresh start");
      }
    };

    rehydrate();
  }, []);

  return (
    <ActiveLockContext.Provider value={{ setActiveLock, clearActiveLock }}>
      {children}
      {/* Admin only — remove once lock system confirmed stable */}
      {user?.role === "admin" && (
        <SessionDebugWidget
          logs={logs}
          lockInfo={lockInfo}
          nextBeat={nextBeat}
        />
      )}
    </ActiveLockContext.Provider>
  );
};

export const useActiveLock = () => useContext(ActiveLockContext);
