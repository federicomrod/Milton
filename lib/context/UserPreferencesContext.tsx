"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/lib/context/UserContext";
import { persistTheme } from "@/lib/theme";
import {
  browserTimeZone,
  preferencesFromAuthUser,
} from "@/lib/profile-service";

interface UserPreferences {
  date_format: string;
  number_format: string;
  timezone: string;
  theme: string;
}

interface UserPreferencesContextType {
  prefs: UserPreferences;
  setPrefs: (prefs: UserPreferences) => void;
  refreshPrefs: () => Promise<void>;
  loading: boolean;
}

const UserPreferencesContext = createContext<UserPreferencesContextType | null>(
  null
);

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [prefs, setPrefs] = useState<UserPreferences>({
    date_format: "DD/MM/YYYY",
    number_format: "1,000.00",
    timezone: browserTimeZone(),
    theme: "light",
  });
  const [loading, setLoading] = useState(true);

  const fetchPrefs = useCallback(async () => {
    try {
      if (!user) {
        setLoading(false);
        return;
      }

      // Preferences live in the Auth user metadata: `profiles` has no
      // currency / date_format / number_format / timezone / theme columns.
      const supabase = createClient();
      const {
        data: { user: authUser },
        error,
      } = await supabase.auth.getUser();

      if (error) {
        console.error("Error loading user preferences:", error);
      }

      const saved = preferencesFromAuthUser(authUser);
      setPrefs((prev) => ({ ...prev, ...saved }));
      if (saved.theme) persistTheme(saved.theme);
    } catch (error) {
      console.error("Failed to fetch preferences:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  const updatePrefs = useCallback((next: UserPreferences) => {
    setPrefs(next);
    persistTheme(next.theme);
  }, []);

  return (
    <UserPreferencesContext.Provider
      value={{
        prefs,
        setPrefs: updatePrefs,
        refreshPrefs: fetchPrefs,
        loading,
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error(
      "useUserPreferences must be used within UserPreferencesProvider"
    );
  }
  return context;
}
