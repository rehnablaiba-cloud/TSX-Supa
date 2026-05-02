// src/components/AppShell.tsx
//
// Persistent wrapper that never unmounts. Owns two things:
//
//   1. SessionExpiredModal — shown when callRpc() in rpc.ts detects an
//      unrecoverable 401 (refresh token dead). The user re-auths in the
//      modal; their current view stays visible behind it.
//
//   2. useSignout hook — exported so any component that currently calls
//      supabase.auth.signOut() directly can call this instead. It runs the
//      three-step cleanup (channels → cache → signOut) in the right order.
//
// PLACEMENT in provider chain (see App.tsx):
//   ThemeProvider > SessionLogProvider > ActiveLockProvider > AppShell > AppInner
//
import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { queryClient } from "../lib/queryClient";
import { sessionExpiredSignal } from "../lib/rpc";

// ─── Signout context ──────────────────────────────────────────────────────────
// Provides an enhanced signout that clears Realtime channels and query cache
// before invalidating the Supabase session.

interface SignoutContextValue {
  signout: () => Promise<void>;
}

const SignoutContext = createContext<SignoutContextValue>({
  signout: async () => { await supabase.auth.signOut(); },
});

/** Call this instead of supabase.auth.signOut() anywhere in the app. */
export function useSignout() {
  return useContext(SignoutContext).signout;
}

// ─── SessionExpiredModal ──────────────────────────────────────────────────────
// Non-dismissable — user must re-authenticate to close it.
// Sits on top of whatever page is currently visible.

function SessionExpiredModal({ onSuccess }: { onSuccess: () => void }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  async function handleSignIn() {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      onSuccess();
    }
  }

  return (
    // Full-screen backdrop — blocks interaction with the page behind
    <div
      style={{
        position:        "fixed",
        inset:           0,
        zIndex:          9999,
        backgroundColor: "rgba(0,0,0,0.7)",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        padding:         "1rem",
      }}
    >
      <div
        style={{
          background:    "var(--bg-card)",
          border:        "1px solid var(--border-color)",
          borderRadius:  "12px",
          padding:       "2rem",
          width:         "min(90vw, 380px)",
          display:       "flex",
          flexDirection: "column",
          gap:           "1rem",
          boxShadow:     "0 25px 50px rgba(0,0,0,0.5)",
        }}
      >
        <div>
          <h2
            style={{
              margin:     0,
              fontSize:   "1.05rem",
              fontWeight: 700,
              color:      "var(--text-primary)",
            }}
          >
            Session Expired
          </h2>
          <p
            style={{
              margin:    "0.4rem 0 0",
              fontSize:  "0.85rem",
              color:     "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            Your session has expired. Sign in again to continue —
            your work is still here.
          </p>
        </div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          style={inputStyle}
        />

        {error && (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-fail)" }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSignIn}
          disabled={loading || !email || !password}
          style={{
            padding:       "0.65rem",
            borderRadius:  "6px",
            border:        "none",
            background:    "var(--color-brand)",
            color:         "#fff",
            fontWeight:    600,
            cursor:        "pointer",
            fontSize:      "0.9rem",
            opacity:       loading || !email || !password ? 0.5 : 1,
            transition:    "opacity 0.15s",
          }}
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding:      "0.6rem 0.75rem",
  borderRadius: "6px",
  border:       "1px solid var(--border-color)",
  background:   "var(--bg-surface)",
  color:        "var(--text-primary)",
  fontSize:     "0.9rem",
  outline:      "none",
  width:        "100%",
  boxSizing:    "border-box",
};

// ─── AppShell ─────────────────────────────────────────────────────────────────

interface AppShellProps {
  children: React.ReactNode;
}

const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const [showExpiredModal, setShowExpiredModal] = useState(false);

  // ── Listen for session expiry signal from callRpc() ─────────────────────
  // When the refresh token is dead and a silent refresh fails, callRpc
  // emits this signal. We show the modal on top of the current view.
  useEffect(() => {
    const unsub = sessionExpiredSignal.subscribe(() => {
      setShowExpiredModal(true);
    });
    return unsub;
  }, []);

  // ── Enhanced signout ─────────────────────────────────────────────────────
  // Order matters:
  //   1. Remove all Realtime channels — no more live data from old session
  //   2. Clear query cache — no stale data remains in memory
  //   3. Sign out from Supabase — JWT is destroyed
  // AppShell stays mounted; auth state change re-renders to LoginPage.
  const signout = async () => {
    await supabase.removeAllChannels();
    queryClient.clear();
    await supabase.auth.signOut();
  };

  return (
    <SignoutContext.Provider value={{ signout }}>
      {children}

      {showExpiredModal && (
        <SessionExpiredModal
          onSuccess={() => setShowExpiredModal(false)}
        />
      )}
    </SignoutContext.Provider>
  );
};

export default AppShell;
