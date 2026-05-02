import { useAuth } from "../context/AuthContext";
import { insertAuditEvent } from "../lib/rpc.ts";

const useaudit_log = () => {
  const { user } = useAuth();

  const log = (
    action: string,
    severity: "pass" | "fail" | "warn" | "info" = "info"
  ) => {
    if (!user) return;
    insertAuditEvent({
      user_id:   user.id,
      username: user.display_name ?? user.email ?? "unknown",
      action,
      severity,
    });
  };

  return log;
};

export default useaudit_log;