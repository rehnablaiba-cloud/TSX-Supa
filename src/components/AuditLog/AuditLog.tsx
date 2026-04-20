import React, { useEffect, useState } from "react";
import { Lock } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import type { AuditEvent } from "../../types";

import { fetchAuditLog, AuditLog } from "../../lib/supabase/queries.auditlog";

const DOT: Record<string, string> = {
  pass: "bg-green-500",
  fail: "bg-red-500",
  warn: "bg-amber-500",
  info: "bg-blue-500",
};

const audit_log: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    fetchAuditLog()
      .then((data: AuditLog[]) => setEvents(data as unknown as AuditEvent[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title="Audit Log" subtitle="Admin only" />
        <div className="flex flex-col items-center justify-center flex-1 gap-4 p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Lock size={24} className="text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-t-primary">Access Restricted</p>
            <p className="text-sm text-t-muted mt-1">
              Only admins can view the audit log.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title="Audit Log" subtitle="Last 300 events" />
      <div className="p-6 flex flex-col gap-3 pb-24 md:pb-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center text-t-muted py-20">
            No audit events yet.
          </div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              className="glass rounded-xl px-4 py-3 flex items-start gap-3"
            >
              <span
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                  DOT[ev.severity ?? ""] ?? "bg-gray-500"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-t-primary">{ev.action}</p>
                <p className="text-xs text-t-muted mt-0.5">
                  <span className="text-t-secondary font-medium">
                    {ev.username}
                  </span>
                  {" · "}
                  {new Date(ev.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default audit_log;
