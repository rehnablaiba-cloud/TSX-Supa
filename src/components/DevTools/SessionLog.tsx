import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal,
  X,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  Wifi,
  Database,
  Navigation,
  ShieldAlert,
  Key,
  Clock,
  GripVertical,
} from "lucide-react";
import {
  useSessionLog,
  LogEntry,
  LogLevel,
  LogCategory,
} from "../../context/SessionLogContext";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";

// ── Styling maps ────────────────────────────────────────────────────────
const LEVEL_DOT: Record<LogLevel, string> = {
  info: "bg-[var(--log-level-info)]",
  success: "bg-[var(--color-pass)]",
  warn: "bg-[var(--log-level-warn)]",
  error: "bg-[var(--log-level-error)]",
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  info: "bg-[var(--log-level-info)]",
  success: "bg-[var(--color-pass)]",
  warn: "bg-[var(--log-level-warn)]",
  error: "bg-[var(--log-level-error)]",
};

const CAT_STYLE: Record<LogCategory, string> = {
  auth: "badge-log-auth",
  query: "badge-log-info",
  realtime: "badge-log-info", // or create badge-log-success if you want teal
  nav: "badge-log-warn", // or use text-t-muted bg-bg-card
  session: "badge-log-warn",
  error: "badge-log-error",
};

const CAT_ICON: Record<LogCategory, React.ReactNode> = {
  auth: <Key size={9} />,
  query: <Database size={9} />,
  realtime: <Wifi size={9} />,
  nav: <Navigation size={9} />,
  session: <Clock size={9} />,
  error: <ShieldAlert size={9} />,
};

const ALL_CATS: LogCategory[] = [
  "auth",
  "query",
  "realtime",
  "nav",
  "session",
  "error",
];

function fmt(d: Date) {
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Theme-aware glass styles ────────────────────────────────────────────
function useLogGlassStyles() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return {
    panel: {
      background: isDark
        ? "rgba(10, 10, 16, 0.92)"
        : "rgba(248, 250, 252, 0.92)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    },
    logText: isDark ? "#e2e8f0" : "#1e293b",
    mutedText: isDark ? "#64748b" : "#94a3b8",
    border: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    detailBg: isDark ? "rgba(0,0,0,0.30)" : "rgba(241,245,249,0.60)",
  };
}

// ── Single log row ──────────────────────────────────────────────────────
const EntryRow: React.FC<{
  entry: LogEntry;
  styles: ReturnType<typeof useLogGlassStyles>;
}> = ({ entry, styles }) => {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`border-b last:border-b-0 px-3 py-1.5 transition-colors
        ${
          entry.detail
            ? "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
            : ""
        }
        ${entry.level === "error" ? "bg-[var(--color-fail)]/5" : ""`}
      style={{ borderColor: styles.border }}
      onClick={() => entry.detail && setOpen((p) => !p)}
    >
      <div className="flex items-start gap-2">
        {/* Timestamp */}
        <span
          className="text-[10px] font-mono shrink-0 mt-px w-[4.5rem] leading-4"
          style={{ color: styles.mutedText }}
        >
          {fmt(entry.ts)}
        </span>

        {/* Category badge */}
        <span
          className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5
          rounded-full shrink-0 uppercase tracking-wide mt-px ${
            CAT_STYLE[entry.category]
          }`}
        >
          {CAT_ICON[entry.category]}
          {entry.category}
        </span>

        {/* Level dot */}
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
            LEVEL_DOT[entry.level]
          }`}
        />

        {/* Message */}
        <span
          className={`text-[10px] font-mono flex-1 leading-4 break-all
          ${LEVEL_TEXT[entry.level]}`}
        >
          {entry.message}
        </span>

        {/* Expand chevron */}
        {entry.detail && (
          <span className="shrink-0 mt-px" style={{ color: styles.mutedText }}>
            {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {open && entry.detail && (
        <pre
          className="mt-2 ml-[8.5rem] text-[9px] font-mono rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all"
          style={{
            backgroundColor: styles.detailBg,
            color: styles.mutedText,
            border: `1px solid ${styles.border}`,
          }}
        >
          {entry.detail}
        </pre>
      )}
    </div>
  );
};

// ── Draggable position hook ─────────────────────────────────────────────
const STORAGE_KEY = "session-log-pos";

function getDefaultPos() {
  const isMd = typeof window !== "undefined" && window.innerWidth >= 768;
  return { right: isMd ? 24 : 16, bottom: isMd ? 24 : 96 };
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
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startRight: 0,
    startBottom: 0,
  });

  const clamp = useCallback((next: { right: number; bottom: number }) => {
    const padding = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = pillRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 140;
    const h = rect?.height ?? 40;
    return {
      right: Math.max(padding, Math.min(vw - w - padding, next.right)),
      bottom: Math.max(padding, Math.min(vh - h - padding, next.bottom)),
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
    // Return whether it was a click or a drag
    return !dragRef.current.moved;
  }, [pos]);

  // Keep in bounds on resize
  useEffect(() => {
    const handle = () => setPos((p) => clamp(p));
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [clamp]);

  return { pos, pillRef, onPointerDown, onPointerMove, onPointerUp };
}

// ── Main component ──────────────────────────────────────────────────────
const SessionLog: React.FC = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { entries, clear, errorCount } = useSessionLog();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<LogCategory | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const styles = useLogGlassStyles();
  const suppressClick = useRef(false);

  const { pos, pillRef, onPointerDown, onPointerMove, onPointerUp } =
    useDraggablePosition();

  const isAdmin = user?.role === "admin";
  if (!isAdmin) return null;

  const visible =
    filter === "all" ? entries : entries.filter((e) => e.category === filter);

  // Pill indicator
  const hasError = errorCount > 0;
  const hasWarn = !hasError && entries.some((e) => e.level === "warn");
  const pillDot = hasError
  ? "bg-[var(--color-fail)] animate-pulse"
  : hasWarn ? "bg-[var(--color-warn)]"
  : "bg-[var(--color-pass)]";

  // Auto-scroll to bottom
  useEffect(() => {
    if (!autoScroll || !open) return;
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, autoScroll, open]);

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

  const handlePillClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setOpen((p) => !p);
  };

  const handlePillPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const wasClick = onPointerUp();
    if (wasClick) handlePillClick();
    else suppressClick.current = true;
  };

  return (
    <div
      className="fixed z-[90] flex flex-col items-end gap-2 pointer-events-none"
      style={{ right: pos.right, bottom: pos.bottom }}
    >
      {/* ── Expanded panel ─────────────────────────────────────────── */}
      {open && (
        <div
          className="pointer-events-auto w-[380px] max-w-[calc(100vw-2rem)]
            rounded-2xl border shadow-2xl
            flex flex-col overflow-hidden"
          style={{
            ...styles.panel,
            maxHeight: "min(480px, 60vh)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0"
            style={{ borderColor: styles.border }}
          >
            <Terminal size={13} style={{ color: styles.mutedText }} />
            <span
              className="text-xs font-bold flex-1"
              style={{ color: styles.logText }}
            >
              Session Log
            </span>
            <span
              className="text-[10px] mr-1"
              style={{ color: styles.mutedText }}
            >
              {entries.length} events
            </span>
            <button
              onClick={clear}
              title="Clear log"
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
                ${filter === "all" ? "bg-c-brand text-white" : ""}`}
              style={filter === "all" ? {} : { color: styles.mutedText }}
            >
              All · {entries.length}
            </button>
            {ALL_CATS.map((cat) => {
              const count = entries.filter((e) => e.category === cat).length;
              if (!count) return null;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`flex items-center gap-0.5 text-[9px] font-bold px-2 py-1
                    rounded-full shrink-0 uppercase tracking-wide transition-colors
                    ${
                      filter === cat
                        ? "bg-c-brand text-white"
                        : `${CAT_STYLE[cat]} opacity-75 hover:opacity-100`
                    }`}
                >
                  {CAT_ICON[cat]}
                  {cat} · {count}
                </button>
              );
            })}
          </div>

          {/* Entries list */}
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
                <Terminal size={22} className="opacity-30" />
                <p className="text-xs opacity-50">No entries for this filter</p>
              </div>
            ) : (
              visible.map((e) => (
                <EntryRow key={e.id} entry={e} styles={styles} />
              ))
            )}
          </div>

          {/* Jump-to-latest strip */}
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

      {/* ── Floating pill (glass-frost, draggable) ─────────────────── */}
      <button
        ref={pillRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={handlePillPointerUp}
        className="pointer-events-auto flex items-center gap-2 px-3 py-2
          shadow-xl transition-transform hover:scale-105 active:scale-95
          glass-frost !rounded-full cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: "none" }}
        title="Drag to move • Click to open Session Log"
      >
        <GripVertical size={12} className="opacity-40 -ml-1" />
        <span className={`w-2 h-2 rounded-full shrink-0 ${pillDot}`} />
        <Terminal size={13} style={{ color: styles.mutedText }} />
        <span
          className="text-[10px] font-mono"
          style={{ color: styles.mutedText }}
        >
          {entries.length}
        </span>
        {errorCount > 0 && (
          <span
          className="text-[9px] font-bold bg-[var(--color-fail)] text-white"
          >
            {errorCount} err
          </span>
        )}
      </button>
    </div>
  );
};

export default SessionLog;
