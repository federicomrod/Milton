// components/restaurant/shell/ask-milton-controller.tsx
//
// Lets Sales (and later other pages) open the existing Ask Milton drawer
// with a pre-filled question. Lives in the shell so the conversation
// survives close/reopen.

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { bumpAskMiltonPrefill } from "@/lib/restaurant/sales-explore";

export interface AskMiltonController {
  open: boolean;
  draft: string | null;
  nonce: number;
  openAskMilton: (draft?: string) => void;
  onOpenChange: (open: boolean) => void;
}

const AskMiltonControllerContext = createContext<AskMiltonController | null>(
  null
);

export function AskMiltonControllerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<{
    draft: string | null;
    nonce: number;
  }>({ draft: null, nonce: 0 });

  const openAskMilton = useCallback((question?: string) => {
    setPrefill((prev) => {
      const next = bumpAskMiltonPrefill(prev.nonce, question);
      return { draft: next.draft, nonce: next.nonce };
    });
    setOpen(true);
  }, []);

  const value = useMemo<AskMiltonController>(
    () => ({
      open,
      draft: prefill.draft,
      nonce: prefill.nonce,
      openAskMilton,
      onOpenChange: setOpen,
    }),
    [open, prefill, openAskMilton]
  );

  return (
    <AskMiltonControllerContext.Provider value={value}>
      {children}
    </AskMiltonControllerContext.Provider>
  );
}

export function useAskMiltonController(): AskMiltonController {
  const value = useContext(AskMiltonControllerContext);
  if (!value) {
    return {
      open: false,
      draft: null,
      nonce: 0,
      openAskMilton: () => {},
      onOpenChange: () => {},
    };
  }
  return value;
}
