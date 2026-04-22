import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role?: "admin" | "user" | string;
}

interface AuthCtx {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

// ── Profile loader ─────────────────────────────────────────────────────────────
const loadProfile = async (
  user_id: string,
  email: string
): Promise<AuthUser | null> => {
  const { data } = await supabase
    .from("profiles")
    .select("display_name, role, disabled")
    .eq("id", user_id)
    .single();

  if (data?.disabled) return null;

  return {
    id: user_id,
    email,
    display_name: data?.display_name ?? email,
    role: data?.role ?? "tester",
  };
};

// ── Update logged_in ───────────────────────────────────────────────────────────
// Fires the Postgres trigger that cleans stale test_locks
export const updateLoggedIn = async (user_id: string) => {
  const { error } = await supabase
    .from("profiles")
    .update({ logged_in: new Date().toISOString() })
    .eq("id", user_id);

  if (error) {
    console.warn("[AuthContext] Failed to update logged_in:", error.message);
  } else {
    console.log("[AuthContext] logged_in updated → stale lock trigger fired");
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  const handleSession = async (sessionUser: {
    id: string;
    email?: string | null;
  }) => {
    const profile = await loadProfile(sessionUser.id, sessionUser.email ?? "");

    if (!profile) {
      await supabase.auth.signOut();
      setUser(null);
      return;
    }

    // Immediate update on login → fires stale lock trigger
    await updateLoggedIn(sessionUser.id);

    setUser(profile);
  };

  // ── Periodic logged_in refresh while user is active ────────────────────────
  // Keeps the stale lock trigger firing every 2min even if user stays on
  // dashboard and never enters a test — covers force-close scenarios
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      updateLoggedIn(user.id);
    }, 2 * 60 * 1000);

    return () => clearInterval(interval); // stops on logout / user change
  }, [user?.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        handleSession(session.user).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        handleSession(session.user).finally(() => setIsLoading(false));
      } else {
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (
    email: string,
    password: string
  ): Promise<{ error?: string }> => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { error: error.message };
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <Ctx.Provider
      value={{ isLoading, isAuthenticated: !!user, user, signIn, signOut }}
    >
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);
