// AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabase";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  defaultRole: string;
}

interface AuthCtx {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

const loadProfile = async (userId: string, email: string): Promise<AuthUser> => {
  const { data } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", userId)
    .single();
  return {
    id: userId,
    email,
    displayName: data?.display_name ?? email,
    defaultRole: data?.role ?? "tester",
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    // ✅ getSession is local (reads from storage) — no network call
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // ✅ Unblock render immediately with basic info
        setUser({
          id: session.user.id,
          email: session.user.email ?? "",
          displayName: session.user.email ?? "",
          defaultRole: "tester",
        });
        setIsLoading(false); // ✅ App renders now, don't wait for profile

        // ✅ Enrich with profile data in background
        loadProfile(session.user.id, session.user.email ?? "").then(setUser);
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email ?? "",
            displayName: session.user.email ?? "",
            defaultRole: "tester",
          });
          loadProfile(session.user.id, session.user.email ?? "").then(setUser);
        } else {
          setUser(null);
        }
        setIsLoading(false);
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