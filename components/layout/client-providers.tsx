"use client";

import { ThemeProvider } from "@/components/layout/theme-provider";
import { ReactNode } from "react";

export function ClientProviders({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
