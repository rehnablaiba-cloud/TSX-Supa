import { useAuth } from "../context/AuthContext";
import { insertAuditEvent } from "../lib/supabase/queries.auditlog";

/**
 * Returns a fire-and-forget `log(action, severity?)` helper.
 * The actual supabase call lives in queries.auditlog.ts.
 */
const useAuditLog = () => {
  const user = useAuth();

  const log = (
    action: string,
    severity: "pass" | "fail" | "warn" | "info" = "info"
  ) => {
    if (!user) return;
    insertAuditEvent({
      userid:   user.id,
      username: user.displayName ?? user.email ?? "unknown",
      action,
      severity,
    });
  };

  return log;
};

export default useAuditLog;
