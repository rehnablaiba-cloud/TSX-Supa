/**
 * queries.auditlog.ts
 * Supabase calls for the audit_log table.
 */
import { supabase } from "../../supabase";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  severity: "pass" | "fail" | "warn" | "info";
  created_at: string;
}

export interface AuditEventPayload {
  user_id: string;
  username: string;
  action: string;
  severity: "pass" | "fail" | "warn" | "info";
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch all audit log entries, newest first.
 */
export const fetchAuditLog = async (): Promise<AuditLog[]> => {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[audit_log] fetch error", error);
    return [];
  }

  return data as AuditLog[];
};

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget audit log insert.
 * Errors are swallowed and logged to console.
 */
export function insertAuditEvent(payload: AuditEventPayload): void {
  supabase
    .from("audit_log")
    .insert(payload)
    .then(({ error }) => {
      if (error) console.error("[audit_log] insert error", error);
    });
}
