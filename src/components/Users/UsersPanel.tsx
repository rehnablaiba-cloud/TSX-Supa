import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import ConfirmDialog from "../UI/ConfirmDialog";
import Topbar from "../Layout/Topbar";
import { useToast } from "../../context/ToastContext";
import { useAuditLog } from "../../hooks/useAuditLog";
import { AppUser, Role } from "../../types";

const EMPTY: {
  display_name: string; email: string; password: string; defaultRole: Role; disabled: boolean;
} = { display_name: "", email: "", password: "", defaultRole: "tester", disabled: false };

const UsersPanel: React.FC = () => {
  const { user: currentUser } = useAuth();
  const { addToast } = useToast();
  const { log } = useAuditLog();
  const [users, setUsers]               = useState<AppUser[]>([]);
  const [search, setSearch]             = useState("");
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState({ ...EMPTY });
  const [editId, setEditId]             = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [loading, setLoading]           = useState(false);

  const filtered = users.filter(u =>
    `${u.display_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  // ── Helper: get current auth token ────────────────────────
  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  };

  const edgeFn = async (body: object) => {
    const token = await getToken();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(body),
      }
    );
    return res.json();
  };

  // ── Load users ─────────────────────────────────────────────
  const loadUsers = async () => {
    const data = await edgeFn({ action: "list" });
    setUsers(Array.isArray(data) ? data : []);
  };

  useEffect(() => { loadUsers(); }, []);

  // ── Save (create / update) ─────────────────────────────────
  const handleSave = async () => {
    setLoading(true);
    try {
      const action  = editId ? "update" : "create";
      const payload = editId
        ? { id: editId, display_name: form.display_name, role: form.defaultRole }
        : { email: form.email, password: form.password, display_name: form.display_name, role: form.defaultRole };

      const data = await edgeFn({ action, payload });
      if (data.error) throw new Error(data.error);

      log(editId ? `Edited user: ${form.email}` : `Created user: ${form.email}`, "info");
      addToast(editId ? "User updated" : "User created", "success");
      await loadUsers();
    } catch (e: any) {
      addToast(e.message || "Error saving user", "error");
    }
    setLoading(false); setShowForm(false); setEditId(null); setForm({ ...EMPTY });
  };

  // ── Delete ─────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    await edgeFn({ action: "delete", payload: { id: deleteTarget.id } });
    log(`Deleted user: ${deleteTarget.email}`, "warn");
    addToast("User deleted", "success");
    setDeleteTarget(null);
    await loadUsers();
  };

  return (
    <div className="flex-1 flex flex-col">
      <Topbar title="Users" subtitle="Admin panel"
        actions={
          <button onClick={() => { setShowForm(true); setEditId(null); setForm({ ...EMPTY }); }}
            className="btn-primary text-sm">+ Add User</button>
        }
      />
      <div className="p-6 flex flex-col gap-4 pb-24 md:pb-6">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search users…" className="input max-w-sm" />
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-400 border-b border-white/5">
              <th className="pb-3 pr-4 font-medium">User</th>
              <th className="pb-3 pr-4 font-medium">Role</th>
              <th className="pb-3 pr-4 font-medium">Status</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold">
                        {(u.display_name || u.email)[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-white">{u.display_name}</p>
                        <p className="text-xs text-gray-500">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={u.defaultRole === "admin" ? "badge-admin" : "badge-tester"}>{u.defaultRole}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${u.disabled ? "bg-gray-700 text-gray-400" : "bg-green-500/20 text-green-400"}`}>
                      {u.disabled ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <button onClick={() => {
                          setEditId(u.id);
                          setForm({ display_name: u.display_name, email: u.email, password: "", defaultRole: u.defaultRole, disabled: u.disabled });
                          setShowForm(true);
                        }} className="text-xs btn-ghost py-1 px-3">Edit</button>
                      <button disabled={u.id === currentUser?.id} onClick={() => setDeleteTarget(u)}
                        className="text-xs px-3 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-30 transition-colors">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-gray-500">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-5">{editId ? "Edit User" : "Add User"}</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Display Name</label>
                <input value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} className="input" />
              </div>
              {!editId && <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Password</label>
                  <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} className="input" />
                </div>
              </>}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Role</label>
                <select value={form.defaultRole} onChange={e => setForm(p => ({ ...p, defaultRole: e.target.value as Role }))} className="input">
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