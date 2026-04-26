import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { supabase } from "../supabase";
import { useAuth, updateLoggedIn } from "./AuthContext";

const HEARTBEAT_MS = 30_000;
const STALE_MS = 2 * 60 * 1000;
const STORAGE_KEY = "lock-monitor-pos";

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

/**
 * Category colours use CSS custom properties so they respect
 * whatever theme / brand overrides the app has applied.
 */
const CATEGORY_VAR: Record<SessionLog["category"], string> = {
  heartbeat: "var(--color-brand)",
  rehydrate: "var(--color-pend)",
  lock: "var(--color-pass)",
  system: "var(--text-muted)",
};

const STATUS_ICON: Record<SessionLog["status"], string> = {
  ok: "✅",
  error: "❌",
  pending: "⏳",
  info: "ℹ️",
  warn: "⚠️",
};

// ─── useDraggablePosition ─────────────────────────────────────────────────────
/**
 * Right/bottom anchored drag — matches the pattern used by SessionLog's pill.
 * Position is persisted to localStorage so the widget remembers where you
 * left it across page refreshes.
 */
function getDefaultPos() {
  return { right: 16, bottom: 16 };
}

function useDraggablePosition() {
  const [pos, setPos] = useState<{ right: number; bottom: number }>(() => {
    if (typeof window === "undefined") return getDefaultPos();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...getDefaultPos(), ...JSON.parse(saved) };
    } catch {}
    return getDefaultPos();
  });

  const handleRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startRight: 0,
    startBottom: 0,
  });
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  const clamp = useCallback((next: { right: number; bottom: number }) => {
    const padding = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = handleRef.current
      ?.closest<HTMLElement>("[data-draggable]")
      ?.getBoundingClientRect();
    const w = rect?.width ?? 380;
    const h = rect?.height ?? 300;
    return {
      right: Math.max(padding, Math.min(vw - w - padding, next.right)),
      bottom: Math.max(padding, Math.min(vh - h - padding, next.bottom)),
    };
  }, []);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      handle.setPointerCapture(e.pointerId);
      dragRef.current = {
        active: true,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        startRight: posRef.current.right,
        startBottom: posRef.current.bottom,
      };
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
      const next = clamp({
        right: dragRef.current.startRight - dx,
        bottom: dragRef.current.startBottom - dy,
      });
      posRef.current = next;
      setPos(next);
    };

    const onPointerUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(posRef.current));
    };

    handle.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [clamp]);

  // Keep in bounds on viewport resize
  useEffect(() => {
    const handle = () => setPos((p) => clamp(p));
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [clamp]);

  return { pos, handleRef };
}

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
  const { pos, handleRef } = useDraggablePosition();

  const filtered =
    filter === "all" ? logs : logs.filter((l) => l.category === filter);

  return (
    <div
      data-draggable
      style={{
        position: "fixed",
        right: pos.right,
        bottom: pos.bottom,
        zIndex: 9999,
        width: minimized ? "auto" : 380,
        fontFamily: "monospace",
        fontSize: 11,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid var(--border-color)",
        background: "var(--bg-base)",
        boxShadow:
          "0 4px 32px color-mix(in srgb, var(--bg-base) 60%, transparent)",
        transition: "box-shadow 0.25s ease",
      }}
    >
      {/* ── Header / drag handle ───────────────────────────────────────── */}
      <div
        ref={handleRef}
        style={{
          background: "var(--bg-nav)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          padding: "7px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "grab",
          borderBottom: "1px solid var(--border-color)",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <span
          style={{
            color: "var(--color-brand)",
            fontWeight: "bold",
            fontSize: 12,
          }}
        >
          🛡️ Lock Session Monitor
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lockInfo && !minimized && (
            <span
              style={{
                background:
                  "color-mix(in srgb, var(--color-pass) 15%, transparent)",
                color: "var(--color-pass)",
                border:
                  "1px solid color-mix(in srgb, var(--color-pass) 30%, transparent)",
                borderRadius: 99,
                padding: "1px 7px",
                fontSize: 10,
                pointerEvents: "none",
              }}
            >
              🔒 LOCKED
            </span>
          )}

          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMinimized((p) => !p)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
              lineHeight: 1,
              padding: "2px 4px",
            }}
          >
            {minimized ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* ── Lock info panel ───────────────────────────────────────── */}
          <div
            style={{
              padding: "8px 10px",
              borderBottom: "1px solid var(--border-color)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              background: "var(--bg-surface)",
            }}
          >
            <div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 10,
                  marginBottom: 2,
                }}
              >
                STATUS
              </div>
              <div
                style={{
                  color: lockInfo ? "var(--color-pass)" : "var(--color-fail)",
                  fontWeight: "bold",
                }}
              >
                {lockInfo ? "🔒 Active" : "🔓 No Lock"}
              </div>
            </div>

            <div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 10,
                  marginBottom: 2,
                }}
              >
                NEXT HEARTBEAT
              </div>
              <div
                style={{
                  color: lockInfo ? "var(--color-pend)" : "var(--text-muted)",
                }}
              >
                {lockInfo && nextBeat !== null ? `in ${nextBeat}s` : "—"}
              </div>
            </div>

            {lockInfo && (
              <>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 10,
                      marginBottom: 2,
                    }}
                  >
                    TEST
                  </div>
                  <div
                    style={{
                      color: "var(--text-primary)",
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
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 10,
                      marginBottom: 2,
                    }}
                  >
                    USER ID
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    {lockInfo.user_id.slice(0, 12)}...
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Category filter tabs ──────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: "6px 8px",
              borderBottom: "1px solid var(--border-color)",
              overflowX: "auto",
              background: "var(--bg-surface)",
            }}
          >
            {(["all", "heartbeat", "rehydrate", "lock", "system"] as const).map(
              (cat) => {
                const active = filter === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setFilter(cat)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: 99,
                      border: "1px solid",
                      borderColor: active
                        ? "var(--color-brand)"
                        : "var(--border-color)",
                      background: active
                        ? "color-mix(in srgb, var(--color-brand) 12%, transparent)"
                        : "transparent",
                      color: active
                        ? "var(--color-brand)"
                        : cat === "all"
                        ? "var(--text-muted)"
                        : CATEGORY_VAR[cat as Exclude<typeof cat, "all">],
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
                );
              }
            )}
          </div>

          {/* ── Log rows ──────────────────────────────────────────────── */}
          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              padding: "4px 0",
              background: "var(--bg-base)",
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ color: "var(--text-muted)", padding: "8px 10px" }}>
                No logs yet...
              </div>
            ) : (
              [...filtered].reverse().map((log, i) => {
                const statusColor =
                  log.status === "ok"
                    ? "var(--color-pass)"
                    : log.status === "error"
                    ? "var(--color-fail)"
                    : log.status === "warn"
                    ? "var(--color-pend)"
                    : log.status === "pending"
                    ? "var(--color-pend)"
                    : "var(--text-secondary)";
                return (
                  <div
                    key={i}
                    style={{
                      padding: "3px 10px",
                      borderBottom: "1px solid var(--bg-surface)",
                      display: "grid",
                      gridTemplateColumns: "68px 76px 1fr",
                      gap: 4,
                      alignItems: "start",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                      {log.time}
                    </span>
                    <span
                      style={{
                        color: CATEGORY_VAR[log.category],
                        fontSize: 10,
                      }}
                    >
                      [{log.category}]
                    </span>
                    <span
                      style={{ color: statusColor, wordBreak: "break-word" }}
                    >
                      {STATUS_ICON[log.status]} {log.message}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Footer ────────────────────────────────────────────────── */}
          <div
            style={{
              padding: "5px 10px",
              borderTop: "1px solid var(--border-color)",
              display: "flex",
              justifyContent: "space-between",
              color: "var(--text-muted)",
              fontSize: 10,
              background: "var(--bg-nav)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <span>heartbeat every {HEARTBEAT_MS / 1000}s</span>
            <span>stale after {STALE_MS / 1000}s</span>
            <span
              style={{ cursor: "pointer", color: "var(--text-secondary)" }}
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
        </>
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
