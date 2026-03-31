import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import { AuditEvent } from "../../types";

const DOT: Record<string, string> = {
  pass: "bg-green-500", fail: "bg-red-500", warn: "bg-amber-500", info: "bg-blue-500",
};

const AuditLog: React.FC = () => {
  const [events, setEvents]   = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("auditlog")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => { setEvents(data ?? []); setLoading(false); });
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title="Audit Log" subtitle="Last 300 events" />
      <div className="p-6 flex flex-col gap-3 pb-24 md:pb-6">
        {loading
          ? <div className="flex justify-center py-20"><Spinner /></div>
          : events.map(ev => (
              <div key={ev.id} className="glass rounded-xl px-4 py-3 flex items-start gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[ev.severity] ?? "bg-gray-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">{ev.action}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="text-gray-400 font-medium">{ev.username}</span> · {new Date(ev.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))
        }
        {!loading && events.length === 0 && <div className="text-center text-gray-500 py-20">No audit events yet.</div>}
      </div>
    </div>
  );
};

export default AuditLog;