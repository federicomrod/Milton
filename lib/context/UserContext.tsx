"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

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

  const fetchUser = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/user", {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          // If unauthorized and we haven't retried too many times, wait a bit and retry
          if (retryCount < 3) {
            console.log(
              `[UserContext] User fetch failed (401), retrying (${retryCount + 1}/3)...`
            );
            setRetryCount((prev) => prev + 1);
            setTimeout(() => fetchUser(), 1000 * (retryCount + 1)); // Exponential backoff
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
      setRetryCount(0); // Reset retry count on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const refetch = async () => {
    await fetchUser();
  };

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
