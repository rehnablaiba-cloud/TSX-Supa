import { supabase } from "../supabase";

type LogFn = (
  level: "info" | "success" | "warn" | "error",
  category: "query" | "realtime",
  message: string,
  detail?: string
) => void;

/**
 * Wrap a supabase .from() call so every query is logged.
 * Usage:  const { data, error } = await qlog(log, "modules").select("*");
 *         const { data, error } = await qlog(log, "tests").insert({...});
 */
export function qlog(logFn: LogFn, table: string) {
  const builder = supabase.from(table);

  // Proxy every chainable method to intercept the final .then()
  const wrap = (method: string, originalBuilder: any) => {
    const original = originalBuilder[method].bind(originalBuilder);
    return (...args: any[]) => {
      const result = original(...args);
      const originalThen = result.then?.bind(result);
      if (!originalThen) return result;

      return {
        ...result,
        then: (onfulfilled: any, onrejected: any) =>
          originalThen((res: any) => {
            const { data, error } = res ?? {};
            if (error) {
              logFn(
                "error", "query",
                `${method.toUpperCase()} ${table} → ${error.message}`,
                JSON.stringify(error, null, 2)
              );
            } else {
              const count = Array.isArray(data) ? data.length : data ? 1 : 0;
              logFn(
                "success", "query",
                `${method.toUpperCase()} ${table} → ${count} row${count !== 1 ? "s" : ""}`,
              );
            }
            return onfulfilled?.(res);
          }, onrejected),
      };
    };
  };

  return new Proxy(builder, {
    get(target: any, prop: string) {
      if (["select","insert","update","upsert","delete"].includes(prop)) {
        return wrap(prop, target);
      }
      return typeof target[prop] === "function"
        ? target[prop].bind(target)
        : target[prop];
    },
  });
}

/**
 * Log a realtime channel subscription event.
 * Usage: rlog(log, "modules_realtime", "subscribed");
 */
export function rlog(logFn: LogFn, channel: string, event: string, detail?: string) {
  logFn("info", "realtime", `${channel} → ${event}`, detail);
}