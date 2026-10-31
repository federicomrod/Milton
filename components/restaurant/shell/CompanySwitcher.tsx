"use client";

// The top-left switcher lists every company the person belongs to (a Milton
// admin can belong to several). Picking one makes it the active company and
// reloads the app on it; only companies the person belongs to can be chosen
// (the server action checks the membership).

import { useState } from "react";
import { Check } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n/client";
import { useRestaurantShellChrome } from "@/components/restaurant/shell/shell-chrome-context";
import { switchCompanyAction } from "@/app/dashboard/restaurant/support-actions";

function useSwitchCompany() {
  const { d } = useT();
  const [error, setError] = useState<string | null>(null);
  const switchTo = async (id: string) => {
    setError(null);
    try {
      const res = await switchCompanyAction(id);
      if (res.ok) {
        window.location.assign("/dashboard/restaurant");
        return;
      }
    } catch {
      // fall through to the message
    }
    setError(d.support.switcher.switchFailed);
  };
  return { switchTo, error };
}

/** Inside the restaurant dropdown (desktop). Nothing when there is one company. */
export function CompanyMenuItems() {
  const { companies = [], activeCompanyId } = useRestaurantShellChrome();
  const { d } = useT();
  const { switchTo, error } = useSwitchCompany();
  if (companies.length < 2) return null;
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        {d.support.switcher.company}
      </DropdownMenuLabel>
      {companies.map((c) => (
        <DropdownMenuItem key={c.id} onClick={() => void switchTo(c.id)}>
          <span className="flex-1 truncate">{c.name}</span>
          {c.isSupport ? (
            <span className="text-[11px] text-muted-foreground">
              {d.support.switcher.support}
            </span>
          ) : null}
          {c.id === activeCompanyId ? (
            <Check className="h-3.5 w-3.5 shrink-0" />
          ) : null}
        </DropdownMenuItem>
      ))}
      {error ? <p className="px-2 py-1 text-xs">{error}</p> : null}
      <DropdownMenuSeparator />
    </>
  );
}

/** The same list for the phone menu. */
export function CompanyList() {
  const { companies = [], activeCompanyId } = useRestaurantShellChrome();
  const { d } = useT();
  const { switchTo, error } = useSwitchCompany();
  if (companies.length < 2) return null;
  return (
    <div className="mb-3 border-b border-border pb-3">
      <p className="px-1 pb-1 text-xs text-muted-foreground">
        {d.support.switcher.company}
      </p>
      <ul className="space-y-1">
        {companies.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => void switchTo(c.id)}
              aria-current={c.id === activeCompanyId ? "true" : undefined}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="flex-1 truncate">{c.name}</span>
              {c.isSupport ? (
                <span className="text-[11px] text-muted-foreground">
                  {d.support.switcher.support}
                </span>
              ) : null}
              {c.id === activeCompanyId ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="px-1 pt-1 text-xs">{error}</p> : null}
    </div>
  );
}
