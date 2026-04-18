import { useAuth } from "../context/AuthContext";
import { insertAuditEvent } from "../lib/supabase/queries.auditlog";

const useAuditLog = () => {
  const { user } = useAuth();

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