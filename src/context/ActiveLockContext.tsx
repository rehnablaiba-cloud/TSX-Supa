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

/**
 * Decorative category colors are intentionally fixed — they serve as
 * visual identifiers in a debug widget and should not invert with the
 * theme. All semantic / structural colors use CSS vars instead.
 */
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

// ─── useDraggable ─────────────────────────────────────────────────────────────
/**
 * Pointer-event drag hook. Works with mouse and touch.
 *
 * Usage:
 *   const { pos, handleRef, isDragging } = useDraggable();
 *   <div data-draggable style={pos ? { top: pos.y, left: pos.x } : { bottom: 16, right: 16 }}>
 *     <div ref={handleRef}>drag me</div>
 *   </div>
 *
 * The widget keeps its default CSS-anchored position (bottom/right) until the
 * first drag, then switches to top/left absolute coordinates. This means the
 * initial placement requires zero calculation.
 */
function useDraggable() {
  // null → use original CSS bottom/right; once dragged, holds top/left px
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const startPtr = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  // Keep latest pos in a ref so the pointermove handler is never stale
  const posRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;

      dragging.current = true;
      setIsDragging(true);
      handle.setPointerCapture(e.pointerId);
      startPtr.current = { x: e.clientX, y: e.clientY };

      // Materialise position from bounding rect on first drag so the
      // widget doesn't jump from its CSS-anchored spot.
      const widget = handle.closest<HTMLElement>("[data-draggable]");
      const rect = widget?.getBoundingClientRect();
      const origin = rect
        ? { x: rect.left, y: rect.top }
        : posRef.current ?? {
            x: window.innerWidth - 396,
            y: window.innerHeight - 300,
          };

      startPos.current = origin;
      // Immediately materialise so pointermove has a base
      posRef.current = origin;
      setPos(origin);

      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startPtr.current.x;
      const dy = e.clientY - startPtr.current.y;
      const next = {
        x: Math.max(
          0,
          Math.min(window.innerWidth - 40, startPos.current.x + dx)
        ),
        y: Math.max(
          0,
          Math.min(window.innerHeight - 40, startPos.current.y + dy)
        ),
      };
      posRef.current = next;
      setPos(next);
    };

    const onPointerUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
    };

    handle.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pos, handleRef, isDragging };
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
  const { pos, handleRef, isDragging } = useDraggable();

  const filtered =
    filter === "all" ? logs : logs.filter((l) => l.category === filter);

  // Switch from CSS bottom/right anchor → explicit top/left after first drag
  const positionStyle: React.CSSProperties = pos
    ? { top: pos.y, left: pos.x, bottom: "auto", right: "auto" }
    : { bottom: 16, right: 16 };

  return (
    <div
      data-draggable
      style={{
        position: "fixed",
        ...positionStyle,
        zIndex: 9999,
        width: minimized ? "auto" : 380,
        fontFamily: "monospace",
        fontSize: 11,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid var(--border-color)",
        boxShadow: isDragging
          ? "0 16px 56px color-mix(in srgb, var(--bg-base) 75%, transparent)"
          : "0 4px 32px color-mix(in srgb, var(--bg-base) 60%, transparent)",
        // Suppress layout transitions while dragging — they fight pointer position
        transition: isDragging
          ? "box-shadow 0.1s ease, transform 0.1s ease"
          : "box-shadow 0.25s ease",
        transform: isDragging ? "scale(1.018)" : "scale(1)",
      }}
    >
      {/* ── Header — this is the drag handle ───────────────────────────────── */}
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
          // Show grab/grabbing cursor; the collapse toggle is a child button
          cursor: isDragging ? "grabbing" : "grab",
          borderBottom: "1px solid var(--border-color)",
          // Prevent text selection while dragging
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
                // Don't let the badge interfere with drag
                pointerEvents: "none",
              }}
            >
              🔒 LOCKED
            </span>
          )}

          {/*
            Collapse toggle is a real <button> so it gets its own click
            target and doesn't conflict with the drag handler on the header.
            onPointerDown stops propagation so clicking the button never
            initiates a drag.
          */}
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
        <div style={{ background: "var(--bg-base)" }}>
          {/* ── Lock info panel ──────────────────────────────────────────────── */}
          <div
            style={{
              padding: "8px 10px",
              borderBottom: "1px solid var(--border-color)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
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

          {/* ── Category filter tabs ─────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: "6px 8px",
              borderBottom: "1px solid var(--border-color)",
              overflowX: "auto",
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
                        : "var(--text-muted)",
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

          {/* ── Log rows ─────────────────────────────────────────────────────── */}
          <div style={{ maxHeight: 220, overflowY: "auto", padding: "4px 0" }}>
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
                    ? "#fb923c"
                    : "var(--text-secondary)";
                return (
                  <div
                    key={i}
                    style={{
                      padding: "3px 10px",
                      borderBottom: "1px solid var(--bg-surface)",
                      display: "grid",
                      gridTemplateColumns: "68px 72px 1fr",
                      gap: 4,
                      alignItems: "start",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
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
                      style={{ color: statusColor, wordBreak: "break-word" }}
                    >
                      {STATUS_ICON[log.status]} {log.message}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Footer ───────────────────────────────────────────────────────── */}
          <div
            style={{
              padding: "5px 10px",
              borderTop: "1px solid var(--border-color)",
              display: "flex",
              justifyContent: "space-between",
              color: "var(--text-muted)",
              fontSize: 10,
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
