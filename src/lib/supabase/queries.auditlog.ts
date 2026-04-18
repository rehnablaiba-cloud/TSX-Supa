/**
 * queries.auditlog.ts
 * Supabase call extracted from useAuditLog.ts
 */
import {supabase} from "../../supabase";

export interface AuditEventPayload {
  userid:   string;
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
    .from("auditlog")
    .insert(payload)
    .then(({ error }) => {
      if (error) console.error("[auditlog]", error);
    });
}
