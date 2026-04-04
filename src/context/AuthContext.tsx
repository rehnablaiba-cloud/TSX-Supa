// AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";

export interface AuthUser {
  id:          string;
  email:       string;
  displayName: string;
  role?: "admin" | "user" | string;
}

interface AuthCtx {
  isLoading:       boolean;
  isAuthenticated: boolean;
  user:            AuthUser | null;
  signIn:  (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

// ── Profile loader ─────────────────────────────────────────────────────────────
// Returns null if the account is disabled — caller must sign the user out.
const loadProfile = async (
  userId: string,
  email:  string
): Promise<AuthUser | null> => {
  const { data } = await supabase
    .from("profiles")
    .select("display_name, role, disabled")
    .eq("id", userId)
    .single();

  // Block disabled accounts at the app level (RLS also blocks DB writes)
  if (data?.disabled) return null;

  return {
    id:          userId,
    email,
    displayName: data?.display_name ?? email,
    role: data?.role         ?? "tester",
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser]           = useState<AuthUser | null>(null);

  // FIX: Do NOT set a temporary user with a guessed role before the profile
  // loads. The previous code set defaultRole:"tester" immediately, causing a
  // brief window where admins were treated as testers by any component that
  // rendered during the background fetch (could hide admin UI or let
  // role-gated checks pass incorrectly).
  //
  // isLoading stays true until loadProfile resolves — the spinner covers the
  // gap so there is no visible flash.
  const handleSession = async (sessionUser: { id: string; email?: string | null }) => {
    const profile = await loadProfile(sessionUser.id, sessionUser.email ?? "");

    if (!profile) {
      // Account is disabled — sign out and clear user
      await supabase.auth.signOut();
      setUser(null);
      return;
    }

    setUser(profile);
  };

  useEffect(() => {
    // getSession is local (reads from storage) — no network call
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        handleSession(session.user).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          handleSession(session.user).finally(() => setIsLoading(false));
        } else {
          setUser(null);
          setIsLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ isLoading, isAuthenticated: !!user, user, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);