"use client";
// components/restaurant/AddRestaurantDialog.tsx
//
// Multi-Restaurant UX v1, Phase 3 — a small, fast, mobile-friendly "Add
// restaurant" flow reached from the restaurant switcher. Collects only
// name, concept type, country, and POS system, reusing the exact same
// option lists/cards as the onboarding wizard (lib/restaurant/onboarding-copy.ts,
// SelectableCard) rather than duplicating them.
//
// On success, navigates to the new restaurant's own view
// (?location=<new id>) so the owner immediately sees the restaurant they
// just added, then refreshes the router so the sidebar's location list
// picks up the new entry.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectableCard } from "@/components/restaurant/onboarding/SelectableCard";
import {
  CONCEPT_TYPE_OPTIONS,
  COUNTRY_OPTIONS,
  POS_SYSTEM_OPTIONS,
  conceptTypeLabel,
  countryLabel,
  posSystemLabel,
  type ConceptType,
  type PosSystemChoice,
} from "@/lib/restaurant/onboarding-copy";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { getDictionary } from "@/lib/i18n";
import { userErrorMessage } from "@/lib/restaurant/user-error";

interface AddRestaurantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang: PreferredLanguage;
}

export function AddRestaurantDialog({
  open,
  onOpenChange,
  lang,
}: AddRestaurantDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [conceptType, setConceptType] = useState<ConceptType | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [posSystem, setPosSystem] = useState<PosSystemChoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !submitting;
  const d = getDictionary(lang).onboarding.addRestaurant;
  const submitFallback = d.failed;

  function resetAndClose(nextOpen: boolean) {
    if (!nextOpen && !submitting) {
      setName("");
      setConceptType(null);
      setCountry(null);
      setPosSystem(null);
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/add-restaurant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, conceptType, country, posSystem }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(userErrorMessage(json, submitFallback));
        setSubmitting(false);
        return;
      }
      resetAndClose(false);
      if (json.locationId) {
        router.push(`/dashboard/restaurant?location=${json.locationId}`);
      }
      router.refresh();
    } catch {
      setError(submitFallback);
      setSubmitting(false);
    }
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onFormSubmit}>
          <DialogHeader>
            <DialogTitle>{d.title}</DialogTitle>
            <DialogDescription>{d.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-restaurant-name">{d.nameLabel}</Label>
              <Input
                id="add-restaurant-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={d.namePlaceholder}
                maxLength={120}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>{d.conceptLabel}</Label>
              <div className="grid grid-cols-3 gap-2">
                {CONCEPT_TYPE_OPTIONS.map((opt) => (
                  <SelectableCard
                    key={opt.value}
                    label={conceptTypeLabel(opt.value, lang)}
                    selected={conceptType === opt.value}
                    onClick={() => setConceptType(opt.value)}
                    className="min-h-[64px] px-2 py-3"
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{d.countryLabel}</Label>
              <Select
                value={country ?? undefined}
                onValueChange={(v) => setCountry(v)}
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder={d.countryPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {countryLabel(c.code, lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{d.posLabel}</Label>
              <div className="grid grid-cols-3 gap-2">
                {POS_SYSTEM_OPTIONS.map((opt) => (
                  <SelectableCard
                    key={opt.value}
                    label={posSystemLabel(opt.value, lang)}
                    selected={posSystem === opt.value}
                    onClick={() => setPosSystem(opt.value)}
                    className="min-h-[64px] px-2 py-3"
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => resetAndClose(false)}
              disabled={submitting}
            >
              {getDictionary(lang).common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
            >
              {submitting ? d.adding : d.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
