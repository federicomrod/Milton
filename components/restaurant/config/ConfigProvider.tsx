"use client";

// components/restaurant/config/ConfigProvider.tsx
//
// Shared by every Configuración section: a toast (mint = saved, white with an
// ink border = error) and the unsaved-changes guard
// (closing the tab, reload and in-app links ask before leaving).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "@/lib/i18n/client";

interface ConfigApi {
  /** Success toast (default) or error toast. */
  notify: (text: string, kind?: "ok" | "error") => void;
  /** A section with unsaved edits registers itself under its id. */
  setDirty: (id: string, dirty: boolean) => void;
}

const ConfigContext = createContext<ConfigApi>({
  notify: () => {},
  setDirty: () => {},
});

export function useConfig(): ConfigApi {
  return useContext(ConfigContext);
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const { d } = useT();
  const [toast, setToast] = useState<{
    text: string;
    kind: "ok" | "error";
  } | null>(null);
  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, kind });
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const setDirty = useCallback((id: string, isDirty: boolean) => {
    if (isDirty) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);

  const message = d.config.shared.unsaved;
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (dirty.current.size === 0 || e.defaultPrevented) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a || a.getAttribute("target") === "_blank") return;
      const url = new URL((a as HTMLAnchorElement).href, location.href);
      if (url.origin !== location.origin) return;
      // Same page (the index links, hash jumps) never leaves.
      if (url.pathname === location.pathname && url.search === location.search)
        return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [message]);

  const api = useMemo(() => ({ notify, setDirty }), [notify, setDirty]);

  return (
    <ConfigContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      >
        {toast ? (
          <p
            role="status"
            data-testid="config-toast"
            className={
              "rounded-lg px-4 py-2 text-sm font-medium text-[#0F172A] shadow-md " +
              (toast.kind === "ok"
                ? "bg-[#A7F3D0]"
                : "border border-[#0F172A] bg-white")
            }
          >
            {toast.text}
          </p>
        ) : null}
      </div>
    </ConfigContext.Provider>
  );
}
