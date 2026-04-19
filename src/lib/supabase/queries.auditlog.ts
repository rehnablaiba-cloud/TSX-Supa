// src/lib/supabase/queries.auditlog.ts
// Imported directly by: useAuditLog.ts

import { supabase } from '../../supabase';

export interface AuditEventPayload {
  user_id:  string;
  username: string;
  action:   string;
  severity: 'pass' | 'fail' | 'warn' | 'info';
}

export interface AuditLogRow {
  id:         string;
  created_at: string;
  severity:   'pass' | 'fail' | 'warn' | 'info';
  action:     string;
  username:   string;
  user_id:    string;
}

/**
 * Fire-and-forget audit log insert.
 * Errors are swallowed and logged to console.
 */
export function insertAuditEvent(payload: AuditEventPayload): void {
  supabase
    .from('audit_log')
    .insert(payload)
    .then(({ error }) => {
      if (error) console.error('[audit_log]', error);
    });
}

export async function fetchAuditLog(limit = 200): Promise<AuditLogRow[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditLogRow[];
}
