"use client";

// components/restaurant/config/InlineEditCard.tsx
//
// «Current values read-only, Editar → form with Guardar / Cancelar». The
// summary is always visible (0 clicks to see); one click on Editar opens the
// form in place (no modal, no sub-page). The form calls useInlineEditor() to
// close itself after a save, mark unsaved edits and show the toast.

import { createContext, useCallback, useContext, useId, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { useConfig } from "./ConfigProvider";

interface EditorApi {
  /** Back to the read-only view (after Guardar or Cancelar). */
  close: () => void;
  /** The form has edits that are not saved yet. */
  setDirty: (dirty: boolean) => void;
  /** Shows the success toast and closes. */
  saved: (text?: string) => void;
  failed: (text?: string) => void;
}

const EditorContext = createContext<EditorApi | null>(null);

export function useInlineEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) {
    return {
      close: () => {},
      setDirty: () => {},
      saved: () => {},
      failed: () => {},
    };
  }
  return api;
}

export function InlineEditCard({
  summary,
  children,
  canEdit = true,
  readOnlyNote,
  editLabel,
}: {
  summary: React.ReactNode;
  /** The form. Rendered only while editing. */
  children: React.ReactNode;
  canEdit?: boolean;
  readOnlyNote?: string;
  editLabel?: string;
}) {
  const { d } = useT();
  const s = d.config.shared;
  const config = useConfig();
  const id = useId();
  const [editing, setEditing] = useState(false);

  const setDirty = useCallback(
    (dirty: boolean) => config.setDirty(id, dirty),
    [config, id]
  );
  const close = useCallback(() => {
    config.setDirty(id, false);
    setEditing(false);
  }, [config, id]);
  const api: EditorApi = {
    close,
    setDirty,
    saved: (text) => {
      config.notify(text ?? s.saved, "ok");
      close();
    },
    failed: (text) => config.notify(text ?? s.saveFailed, "error"),
  };

  if (editing) {
    return (
      <EditorContext.Provider value={api}>{children}</EditorContext.Provider>
    );
  }
  return (
    <div className="space-y-3">
      <dl className="space-y-2">{summary}</dl>
      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex h-9 items-center rounded-lg border border-[#1B40C8] bg-white px-3 text-sm font-semibold text-[#1B40C8] hover:bg-[#EEF2FD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
        >
          {editLabel ?? s.edit}
        </button>
      ) : readOnlyNote ? (
        <p className="text-[13px] text-[#64748B]">{readOnlyNote}</p>
      ) : null}
    </div>
  );
}

/** Guardar / Cancelar for a form inside an InlineEditCard. */
export function EditorButtons({
  saving,
  disabled,
  onCancel,
}: {
  saving: boolean;
  disabled?: boolean;
  onCancel: () => void;
}) {
  const { d } = useT();
  const s = d.config.shared;
  return (
    <div className="flex items-center gap-2 pt-1">
      <button
        type="submit"
        disabled={saving || disabled}
        className="inline-flex h-9 items-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? s.saving : s.save}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm font-medium hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
      >
        {s.cancel}
      </button>
    </div>
  );
}
