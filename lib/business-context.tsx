"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import type { BusinessTypeId } from "./business-types";

const STORAGE_KEY = "milton.businessType";

type BusinessContextValue = {
  businessType: BusinessTypeId | null;
  setBusinessType: (type: BusinessTypeId) => void;
  isLoading: boolean;
};

const BusinessContext = createContext<BusinessContextValue | undefined>(
  undefined,
);

type BusinessProviderProps = {
  children: ReactNode;
};

export function BusinessProvider({ children }: BusinessProviderProps) {
  const [businessType, setBusinessTypeState] = useState<BusinessTypeId | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);

  // Load from localStorage on client
  useEffect(() => {
    try {
      const stored =
        typeof window !== "undefined"
          ? window.localStorage.getItem(STORAGE_KEY)
          : null;
      // Validate the stored value before using it
      if (
        stored === "saas" ||
        stored === "agency" ||
        stored === "fitness_studio"
      ) {
        setBusinessTypeState(stored as BusinessTypeId);
      } else {
        // Ignore invalid values
        if (stored) {
          console.warn("Ignoring invalid stored businessType:", stored);
        }
      }
    } catch (err) {
      console.error("Failed to read businessType from localStorage", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setBusinessType = (type: BusinessTypeId) => {
    setBusinessTypeState(type);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, type);
      }
    } catch (err) {
      console.error("Failed to persist businessType to localStorage", err);
    }

    // Fire-and-forget POST to persist in Supabase
    try {
      // No need to await – but we also don't want to crash the UI if this fails
      void fetch("/api/business-type", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ businessType: type }),
      }).catch((err) => {
        console.error("Failed to persist businessType to Supabase", err);
      });
    } catch (err) {
      console.error("Unexpected error calling /api/business-type", err);
    }
  };

  const value: BusinessContextValue = {
    businessType,
    setBusinessType,
    isLoading,
  };

  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinessContext(): BusinessContextValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) {
    throw new Error(
      "useBusinessContext must be used within a BusinessProvider",
    );
  }
  return ctx;
}
