import React, {
  createContext, useContext, useState,
  useCallback, useEffect, useRef,
} from "react";

export type LogLevel    = "info" | "success" | "warn" | "error";
export type LogCategory = "auth" | "query" | "realtime" | "nav" | "session" | "error";

export interface LogEntry {
  id:       string;
  ts:       Date;
  level:    LogLevel;
  category: LogCategory;
  message:  string;
  detail?:  string;
}

interface SessionLogCtx {
  entries:    LogEntry[];
  log:        (level: LogLevel, category: LogCategory, message: string, detail?: string) => void;
  clear:      () => void;
  errorCount: number;
}

const Ctx = createContext<SessionLogCtx | null>(null);
const MAX = 300;
let uid = 0;

export const SessionLogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const logRef = useRef<SessionLogCtx["log"] | null>(null);

  const log = useCallback<SessionLogCtx["log"]>((level, category, message, detail) => {
    setEntries(prev => {
      const next = [...prev, { id: `sl-${++uid}`, ts: new Date(), level, category, message, detail }];
      return next.length > MAX ? next.slice(next.length - MAX) : next;
    });
  }, []);

  logRef.current = log;
  const clear = useCallback(() => setEntries([]), []);
  const errorCount = entries.filter(e => e.level === "error").length;

  // ── Intercept console.error ────────────────────────────────────────
  useEffect(() => {
    const orig = console.error.bind(console);
    console.error = (...args: any[]) => {
      orig(...args);
      const msg = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      logRef.current?.("error", "error", msg.slice(0, 120), msg.length > 120 ? msg : undefined);
    };
    return () => { console.error = orig; };
  }, []);

  // ── Intercept unhandled rejections ─────────────────────────────────
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message ?? String(e.reason ?? "Unknown rejection");
      logRef.current?.("error", "error", `Unhandled: ${msg.slice(0, 100)}`, msg);
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  return (
    <Ctx.Provider value={{ entries, log, clear, errorCount }}>
      {children}
    </Ctx.Provider>
  );
};

export function useSessionLog() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSessionLog must be used within SessionLogProvider");
  return ctx;
}