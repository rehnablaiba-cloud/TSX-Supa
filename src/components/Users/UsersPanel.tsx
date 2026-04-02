import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import ConfirmDialog from "../UI/ConfirmDialog";
import Topbar from "../Layout/Topbar";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { AppUser, Role } from "../../types";

// ─── Profile row shape returned by Supabase ───────────────────────────────────
interface ProfileRow {
  id: string;
  display_name: string;
  role: Role;
}

const UsersPanel: React.FC = () => {
  const { user: currentUser } = useAuth();
  const { addToast } = useToast();
  const { log } = useAuditLog();
  const [users, setUsers]               = useState<AppUser[]>([]);
  const [search, setSearch]             = useState("");
  const [showForm, setShowForm]         = useState(false);
  const [editTarget, setEditTarget]     = useState<AppUser | null>(null);
  const [editRole, setEditRole]         = useState<Role>("tester");
  const [editName, setEditName]         = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [loading, setLoading]           = useState(false);

  const filtered = users.filter(u =>
    u.display_name.toLowerCase().includes(search.toLowerCase())
  );

  // ── Fetch from profiles table directly ──────────────────────────────────────
  const loadUsers = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, role")
      .order("display_name");

    if (error) {
      addToast("Failed to load users: " + error.message, "error");
      return;
    }

    setUsers(
      (data as ProfileRow[]).map(p => ({
        id:           p.id,
        display_name: p.display_name ?? "",
        email:        "",       // not stored in profiles
        defaultRole:  p.role ?? "tester",
        disabled:     false,    // not stored in profiles
      }))
    );
  };

  useEffect(() => { loadUsers(); }, []);

  // ── Edit (display_name + role) via profiles table ───────────────────────────
  const openEdit = (u: AppUser) => {
    setEditTarget(u);
    setEditName(u.display_name);
    setEditRole(u.defaultRole);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: editName, role: editRole })
        .eq("id", editTarget.id);

      if (error) throw new Error(error.message);

      log(`Edited user: ${editTarget.display_name}`, "info");
      addToast("User updated", "success");
      await loadUsers();
    } catch (e: any) {
      addToast(e.message || "Error saving user", "error");
    }
    setLoading(false);
    setShowForm(false);
    setEditTarget(null);
  };

  // ── Delete still goes through edge function so auth.users is also cleaned up
  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const token = await getToken();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ action: "delete", payload: { id: deleteTarget.id } }),
      }
    );
    const data = await res.json();
    if (data.error) {
      addToast("Delete failed: " + data.error, "error");
    } else {
      log(`Deleted user: ${deleteTarget.display_name}`, "warn");
      addToast("User deleted", "success");
      await loadUsers();
    }
    setDeleteTarget(null);
  };

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title="Users" subtitle="Fetched from profiles" />

      <div className="p-6 flex flex-col gap-4 pb-24 md:pb-6">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search users…" className="input max-w-sm" />

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-t-muted border-b border-[var(--border-color)]">
                <th className="pb-3 pr-4 font-medium">User</th>
                <th className="pb-3 pr-4 font-medium">Role</th>
                <th className="pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-[var(--border-color)] hover:bg-bg-card transition-colors">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-c-brand flex items-center justify-center text-sm font-bold text-white">
                        {(u.display_name || "?")[0].toUpperCase()}
                      </div>
                      <p className="font-medium text-t-primary">
                        {u.display_name || <span className="text-t-muted italic">Unnamed</span>}
                      </p>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={u.defaultRole === "admin" ? "badge-admin" : "badge-tester"}>
                      {u.defaultRole}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(u)}
                        className="text-xs btn-ghost py-1 px-3">Edit</button>
                      <button
                        disabled={u.id === currentUser?.id}
                        onClick={() => setDeleteTarget(u)}
                        className="text-xs px-3 py-1 rounded-lg bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-30 transition-colors">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={3} className="py-10 text-center text-t-muted">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit modal ── */}
      {showForm && editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-t-primary mb-5">Edit User</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs text-t-muted mb-1.5">Display Name</label>
                <input value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="input" />
              </div>
              <div>
                <label className="block text-xs text-t-muted mb-1.5">Role</label>
                <select value={editRole}
                  onChange={e => setEditRole(e.target.value as Role)}
                  className="input">
                  <option value="tester">Tester</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowForm(false)} className="btn-ghost text-sm">Cancel</button>
              <button onClick={handleSave} disabled={loading} className="btn-primary text-sm">
                {loading ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!deleteTarget} title="Delete User"
        message={`Delete "${deleteTarget?.display_name}"? This cannot be undone.`}
        confirmText="Delete" danger
        onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
};

export default UsersPanel;