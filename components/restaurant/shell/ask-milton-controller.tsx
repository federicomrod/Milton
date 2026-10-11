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

export interface AskMiltonController {
  open: boolean;
  draft: string | null;
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
  const [draft, setDraft] = useState<string | null>(null);

  const openAskMilton = useCallback((question?: string) => {
    const next = question?.trim() ?? "";
    setDraft(next.length > 0 ? next : null);
    setOpen(true);
  }, []);

  const value = useMemo<AskMiltonController>(
    () => ({
      open,
      draft,
      openAskMilton,
      onOpenChange: setOpen,
    }),
    [open, draft, openAskMilton]
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
      openAskMilton: () => {},
      onOpenChange: () => {},
    };
  }
  return value;
}
