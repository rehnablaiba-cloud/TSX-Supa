import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";

export const useAuditLog = () => {
  const { user } = useAuth();

  const log = (action: string, severity: "pass" | "fail" | "warn" | "info" = "info") => {
    if (!user) return;
    supabase.from("audit_log").insert({
      user_id:  user.id,
      username: user.displayName || user.email || "unknown",
      action,
      severity,
    }).then(({ error }) => { if (error) console.error(error); });
  };

  return { log };
};