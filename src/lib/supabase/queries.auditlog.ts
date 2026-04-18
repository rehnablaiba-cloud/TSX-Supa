/**
 * queries.audit_log.ts
 * Supabase call extracted from useaudit_log.ts
 */
import {supabase} from "../../supabase";

export interface AuditEventPayload {
  user_id:   string;
  username: string;
  action:   string;
  severity: "pass" | "fail" | "warn" | "info";
}

/**
 * Fire-and-forget audit log insert.
 * Errors are swallowed and logged to console (same behaviour as before).
 */
export function insertAuditEvent(payload: AuditEventPayload): void {
  supabase
    .from("audit_log")
    .insert(payload)
    .then(({ error }) => {
      if (error) console.error("[audit_log]", error);
    });
}
