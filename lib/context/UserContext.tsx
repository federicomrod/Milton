"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { createClient } from "@/lib/supabase/client";

interface User {
  id: string;
  email?: string;
  // Add other user properties as needed
}

interface UserContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  retryCount: number;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // useRef avoids stale closure issues in the recursive retry setTimeout
  const retryCountRef = useRef(0);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/user", {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          if (retryCountRef.current < 3) {
            const next = retryCountRef.current + 1;
            console.log(
              `[UserContext] User fetch failed (401), retrying (${next}/3)...`
            );
            retryCountRef.current = next;
            setRetryCount(next);
            setTimeout(() => fetchUser(), 1000 * next);
            return;
          }
          setUser(null);
        } else {
          throw new Error("Failed to fetch user data");
        }
        return;
      }

      const data = await response.json();
      setUser(data.user || null);
      retryCountRef.current = 0;
      setRetryCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        retryCountRef.current = 0;
        setRetryCount(0);
        fetchUser();
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setLoading(false);
        setError(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchUser]);

  const refetch = useCallback(async () => {
    retryCountRef.current = 0;
    setRetryCount(0);
    await fetchUser();
  }, [fetchUser]);

  return (
    <UserContext.Provider value={{ user, loading, error, refetch, retryCount }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
