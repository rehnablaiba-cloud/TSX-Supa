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
import { useTheme } from "./ThemeContext";
import {
  Shield,
  GripVertical,
  X,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  Lock,
  Activity,
  RefreshCw,
  Settings,
} from "lucide-react";

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
  id: number;
}

// ─── Styling maps ─────────────────────────────────────────────────────────────
const CAT_STYLE: Record<SessionLog["category"], string> = {
  heartbeat: "bg-[color-mix(in_srgb,var(--color-brand)_15%,transparent)] text-[color-mix(in_srgb,var(--color-brand),white_30%)]",
  rehydrate: "bg-[color-mix(in_srgb,var(--color-pend)_15%,transparent)] text-[color-mix(in_srgb,var(--color-warn),white_30%)]",
  lock: "bg-[color-mix(in_srgb,var(--color-pass)_15%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)]",
  system: "bg-[color-mix(in_srgb,var(--text-muted)_15%,transparent)]  text-(--text-muted)",
};

const CAT_ICON: Record<SessionLog["category"], React.ReactNode> = {
  heartbeat: <Activity size={9} />,
  rehydrate: <RefreshCw size={9} />,
  lock: <Lock size={9} />,
  system: <Settings size={9} />,
};

const LEVEL_DOT: Record<SessionLog["status"], string> = {
  ok: "bg-[color-mix(in_srgb,var(--color-pass),white_30%)]",
  error: "bg-[color-mix(in_srgb,var(--color-fail),white_30%)]",
  warn: "bg-(--color-warn)",
  pending: "bg-[color-mix(in_srgb,var(--color-brand),white_30%)]",
  info: "bg-[color-mix(in_srgb,var(--text-muted),white_25%)]",
};

const LEVEL_TEXT: Record<SessionLog["status"], string> = {
  ok: "text-[color-mix(in_srgb,var(--color-pass),white_30%)]",
  error: "text-fail",
  warn: "text-[color-mix(in_srgb,var(--color-warn),white_30%)]",
  pending: "text-[color-mix(in_srgb,var(--color-brand),white_30%)]",
  info: "text-(--text-muted)",
};

const ALL_CATS: SessionLog["category"][] = [
  "heartbeat",
  "rehydrate",
  "lock",
  "system",
];

function fmt(t: string) {
  return t;
}

// ─── Glass styles (mirrors SessionLog) ───────────────────────────────────────
function useLockGlassStyles() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return {
    panel: {
      background: isDark ? "rgba(10,10,16,0.92)" : "rgba(248,250,252,0.92)",
      backdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness))`,
      WebkitBackdropFilter: `blur(var(--glass-blur)) saturate(var(--glass-saturation)) brightness(var(--glass-brightness))`,
      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    },
    logText: isDark ? "#e2e8f0" : "#1e293b",
    mutedText: isDark ? "#64748b" : "#94a3b8",
    border: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    detailBg: isDark ? "rgba(0,0,0,0.30)" : "rgba(241,245,249,0.60)",
  };
}

// ─── Entry row (mirrors SessionLog's EntryRow) ────────────────────────────────
const EntryRow: React.FC<{
  entry: SessionLog;
  styles: ReturnType<typeof useLockGlassStyles>;
}> = ({ entry, styles }) => (
  <div
    className="border-b last:border-b-0 px-3 py-1.5"
    style={{ borderColor: styles.border }}
  >
    <div className="flex items-start gap-2">
      <span
        className="text-[10px] font-mono shrink-0 mt-px w-18 leading-4"
        style={{ color: styles.mutedText }}
      >
        {entry.time}
      </span>
      <span
        className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5
          rounded-full shrink-0 uppercase tracking-wide mt-px ${
            CAT_STYLE[entry.category]
          }`}
      >
        {CAT_ICON[entry.category]}
        {entry.category}
      </span>
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
          LEVEL_DOT[entry.status]
        }`}
      />
      <span
        className={`text-[10px] font-mono flex-1 leading-4 break-all ${
          LEVEL_TEXT[entry.status]
        }`}
      >
        {entry.message}
      </span>
    </div>
  </div>
);

// ─── Draggable position hook (same pattern as SessionLog) ─────────────────────
function getDefaultPos() {
  const isMd = typeof window !== "undefined" && window.innerWidth >= 768;
  return { right: isMd ? 24 : 16, bottom: isMd ? 80 : 160 }; // offset from SessionLog pill
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

  const pillRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startRight: 0,
    startBottom: 0,
  });

  const clamp = useCallback((next: { right: number; bottom: number }) => {
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = pillRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 140;
    const h = rect?.height ?? 40;
    return {
      right: Math.max(pad, Math.min(vw - w - pad, next.right)),
      bottom: Math.max(pad, Math.min(vh - h - pad, next.bottom)),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        active: true,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        startRight: pos.right,
        startBottom: pos.bottom,
      };
    },
    [pos]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
      setPos(
        clamp({
          right: dragRef.current.startRight - dx,
          bottom: dragRef.current.startBottom - dy,
        })
      );
    },
    [clamp]
  );

  const onPointerUp = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    return !dragRef.current.moved;
  }, [pos]);

  useEffect(() => {
    const handle = () => setPos((p) => clamp(p));
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [clamp]);

  return { pos, pillRef, onPointerDown, onPointerMove, onPointerUp };
}

// ─── Debug Widget ─────────────────────────────────────────────────────────────
const SessionDebugWidget = ({
  logs,
  lockInfo,
  nextBeat,
  onClear,
}: {
  logs: SessionLog[];
  lockInfo: { module_test_id: string; user_id: string } | null;
  nextBeat: number | null;
  onClear: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<SessionLog["category"] | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const styles = useLockGlassStyles();
  const suppressClick = useRef(false);

  const { pos, pillRef, onPointerDown, onPointerMove, onPointerUp } =
    useDraggablePosition();

  const visible =
    filter === "all" ? logs : logs.filter((l) => l.category === filter);

  const hasError = logs.some((l) => l.status === "error");
  const hasWarn = !hasError && logs.some((l) => l.status === "warn");
  const pillDot = hasError
    ? "bg-fail animate-pulse"
    : hasWarn
    ? "bg-(--color-warn)"
    : "bg-pass";

  useEffect(() => {
    if (!autoScroll || !open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs, autoScroll, open]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const jumpLatest = () => {
    setAutoScroll(true);
    if (listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  };

  const handlePillPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const wasClick = onPointerUp();
    if (wasClick && !suppressClick.current) setOpen((p) => !p);
    else suppressClick.current = false;
  };

  return (
    <div
      className="fixed z-89 flex flex-col items-end gap-2 pointer-events-none"
      style={{ right: pos.right, bottom: pos.bottom }}
    >
      {/* ── Expanded panel ──────────────────────────────────────────── */}
      {open && (
        <div
          className="pointer-events-auto w-[380px] max-w-[calc(100vw-2rem)]
            rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
          style={{ ...styles.panel, maxHeight: "min(480px, 60vh)" }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0"
            style={{ borderColor: styles.border }}
          >
            <Shield size={13} style={{ color: styles.mutedText }} />
            <span
              className="text-xs font-bold flex-1"
              style={{ color: styles.logText }}
            >
              Lock Session Monitor
            </span>
            {lockInfo && (
              <span className="text-[9px] font-bold bg-[color-mix(in_srgb,var(--color-pass)_15%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] border border-pass/30 px-2 py-0.5 rounded-full mr-1">
                🔒 LOCKED
              </span>
            )}
            {lockInfo && nextBeat !== null && (
              <span
                className="text-[10px] mr-1"
                style={{ color: styles.mutedText }}
              >
                ↻ {nextBeat}s
              </span>
            )}
            <span
              className="text-[10px] mr-1"
              style={{ color: styles.mutedText }}
            >
              {logs.length} events
            </span>
            <button
              onClick={onClear}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: styles.mutedText }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = styles.mutedText)
              }
            >
              <Trash2 size={11} />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: styles.mutedText }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = styles.logText)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = styles.mutedText)
              }
            >
              <X size={11} />
            </button>
          </div>

          {/* Category filter pills */}
          <div
            className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto shrink-0"
            style={{ borderColor: styles.border }}
          >
            <button
              onClick={() => setFilter("all")}
              className={`text-[9px] font-bold px-2 py-1 rounded-full shrink-0 uppercase tracking-wide transition-colors
                ${filter === "all" ? "bg-c-brand text-(--bg-surface)" : ""}`}
              style={filter === "all" ? {} : { color: styles.mutedText }}
            >
              All · {logs.length}
            </button>
            {ALL_CATS.map((cat) => {
              const count = logs.filter((l) => l.category === cat).length;
              if (!count) return null;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`flex items-center gap-0.5 text-[9px] font-bold px-2 py-1
                    rounded-full shrink-0 uppercase tracking-wide transition-colors
                    ${
                      filter === cat
                        ? "bg-c-brand text-(--bg-surface)"
                        : `${CAT_STYLE[cat]} opacity-75 hover:opacity-100`
                    }`}
                >
                  {CAT_ICON[cat]}
                  {cat} · {count}
                </button>
              );
            })}
          </div>

          {/* Entries */}
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto min-h-0 overscroll-contain"
          >
            {visible.length === 0 ? (
              <div
                className="flex flex-col items-center gap-2 py-10"
                style={{ color: styles.mutedText }}
              >
                <Shield size={22} className="opacity-30" />
                <p className="text-xs opacity-50">No entries for this filter</p>
              </div>
            ) : (
              [...visible]
                .reverse()
                .map((l) => <EntryRow key={l.id} entry={l} styles={styles} />)
            )}
          </div>

          {/* Jump to latest */}
          {!autoScroll && (
            <button
              onClick={jumpLatest}
              className="shrink-0 flex items-center justify-center gap-1.5 py-1.5
                text-[10px] font-semibold text-c-brand
                bg-c-brand/10 hover:bg-c-brand/20 transition-colors border-t"
              style={{ borderColor: styles.border }}
            >
              <ArrowDown size={11} />
              Jump to latest
            </button>
          )}
        </div>
      )}

      {/* ── Floating pill ───────────────────────────────────────────── */}
      <button
        ref={pillRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={handlePillPointerUp}
        className="pointer-events-auto flex items-center gap-2 px-3 py-2
          shadow-xl transition-transform hover:scale-105 active:scale-95
          glass-frost rounded-full! cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: "none" }}
        title="Drag to move • Click to open Lock Monitor"
      >
        <GripVertical size={12} className="opacity-40 -ml-1" />
        <span className={`w-2 h-2 rounded-full shrink-0 ${pillDot}`} />
        <Shield size={13} style={{ color: styles.mutedText }} />
        <span
          className="text-[10px] font-mono"
          style={{ color: styles.mutedText }}
        >
          {logs.length}
        </span>
        {lockInfo && (
          <span className="text-[9px] font-bold bg-[color-mix(in_srgb,var(--color-pass)_20%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] px-1.5 py-0.5 rounded-full leading-none">
            locked
          </span>
        )}
        {hasError && (
          <span className="text-[9px] font-bold bg-fail text-(--bg-surface) px-1.5 py-0.5 rounded-full leading-none">
            err
          </span>
        )}
      </button>
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
  const logIdRef = useRef(0);

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
      { time, category, status, message, id: ++logIdRef.current },
    ]);
  };

  const clearLogs = () => setLogs([]);

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
      {user?.role === "admin" && (
        <SessionDebugWidget
          logs={logs}
          lockInfo={lockInfo}
          nextBeat={nextBeat}
          onClear={clearLogs}
        />
      )}
    </ActiveLockContext.Provider>
  );
};

export const useActiveLock = () => useContext(ActiveLockContext);
