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

import { useState } from "react";
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
  type ConceptType,
  type PosSystemChoice,
} from "@/lib/restaurant/onboarding-copy";

interface AddRestaurantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRestaurantDialog({
  open,
  onOpenChange,
}: AddRestaurantDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [conceptType, setConceptType] = useState<ConceptType | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [posSystem, setPosSystem] = useState<PosSystemChoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !submitting;

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
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "Could not add restaurant. Please try again.");
        setSubmitting(false);
        return;
      }
      resetAndClose(false);
      if (json.locationId) {
        router.push(`/dashboard/restaurant?location=${json.locationId}`);
      }
      router.refresh();
    } catch {
      setError("Could not add restaurant. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a restaurant</DialogTitle>
          <DialogDescription>
            Add another restaurant to your account. You can switch between them
            any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="add-restaurant-name">Restaurant name</Label>
            <Input
              id="add-restaurant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pinche Gringo Reforma"
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>What best describes it?</Label>
            <div className="grid grid-cols-3 gap-2">
              {CONCEPT_TYPE_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.value}
                  label={opt.label}
                  selected={conceptType === opt.value}
                  onClick={() => setConceptType(opt.value)}
                  className="min-h-[64px] px-2 py-3"
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Country</Label>
            <Select
              value={country ?? undefined}
              onValueChange={(v) => setCountry(v)}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder="Select a country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>POS system</Label>
            <div className="grid grid-cols-3 gap-2">
              {POS_SYSTEM_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.value}
                  label={opt.label}
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
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Adding..." : "Add restaurant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
