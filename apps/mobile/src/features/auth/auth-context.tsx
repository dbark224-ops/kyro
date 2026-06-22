import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { hasSupabaseConfig } from "@/lib/env";
import { setRememberDevicePreference, supabase } from "@/lib/supabase";

export type AuthStatus =
  | "loading"
  | "signed-in"
  | "signed-out"
  | "unconfigured";

type AuthContextValue = {
  refreshSession: () => Promise<void>;
  session: Session | null;
  signInWithPassword: (
    email: string,
    password: string,
    options?: { rememberDevice?: boolean }
  ) => Promise<void>;
  signOut: () => Promise<void>;
  status: AuthStatus;
  user: User | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function statusForSession(session: Session | null): AuthStatus {
  if (!hasSupabaseConfig) {
    return "unconfigured";
  }

  return session ? "signed-in" : "signed-out";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    hasSupabaseConfig ? "loading" : "unconfigured"
  );

  const refreshSession = useCallback(async () => {
    if (!supabase) {
      setSession(null);
      setStatus("unconfigured");
      return;
    }

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      setSession(null);
      setStatus("signed-out");
      return;
    }

    setSession(data.session);
    setStatus(statusForSession(data.session));
  }, []);

  useEffect(() => {
    void refreshSession();

    if (!supabase) {
      return undefined;
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(statusForSession(nextSession));
    });

    return () => subscription.unsubscribe();
  }, [refreshSession]);

  const signInWithPassword = useCallback(
    async (
      email: string,
      password: string,
      options?: { rememberDevice?: boolean }
    ) => {
      if (!supabase) {
        throw new Error("Supabase mobile environment variables are missing.");
      }

      if (typeof options?.rememberDevice === "boolean") {
        await setRememberDevicePreference(options.rememberDevice);
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      await refreshSession();
    },
    [refreshSession]
  );

  const signOut = useCallback(async () => {
    if (!supabase) {
      setSession(null);
      setStatus("unconfigured");
      return;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    setSession(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      refreshSession,
      session,
      signInWithPassword,
      signOut,
      status,
      user: session?.user ?? null
    }),
    [refreshSession, session, signInWithPassword, signOut, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuthSession must be used inside AuthProvider.");
  }

  return value;
}
