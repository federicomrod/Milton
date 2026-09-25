"use client";
// components/restaurant/onboarding/RestaurantOnboardingWizard.tsx
//
// Fast, card-based restaurant onboarding (replaces the old startup-CFO
// questionnaire for restaurant-pivot signups). Single client component,
// four in-memory steps, no page reloads between them — everything the user
// picks stays in React state until the final submit, which is what makes
// the personalized "ready" screen and POS-dependent next steps trivial.
//
// Persistence is intentionally partial (see the onboarding-complete route
// and the PR/task report for the full explanation):
//   - restaurant name: already exists (companies.name from signup), never
//     re-asked, just displayed.
//   - country (+ derived currency): written to the first restaurant_brands
//     + restaurant_locations rows, created here if they don't exist yet.
//   - concept type, location-count bucket, POS choice, priorities: used
//     for this screen's own personalization only; not yet durably stored
//     (no existing column fits them — see the reported proposed migration).
//   - preferred language (Milton Language Foundation v1): written to
//     companies.preferred_language — a company-level setting, not tied to
//     any one restaurant/location. Defaults intelligently from the chosen
//     country (see lib/restaurant/language.ts) but the user can always
//     override it by picking a card directly.

import { useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  UtensilsCrossed,
  Martini,
  Coffee,
  Croissant,
  Zap,
  MoreHorizontal,
  TrendingUp,
  DollarSign,
  BarChart3,
  Package,
  Trash2,
  LineChart,
  ArrowLeft,
  ArrowRight,
  PartyPopper,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectableCard } from "@/components/restaurant/onboarding/SelectableCard";
import {
  ONBOARDING_COPY,
  CONCEPT_TYPE_OPTIONS,
  LOCATION_COUNT_OPTIONS,
  POS_SYSTEM_OPTIONS,
  PRIORITY_OPTIONS,
  COUNTRY_OPTIONS,
  MAX_PRIORITIES,
  getNextStepCards,
  type ConceptType,
  type LocationCountBucket,
  type PosSystemChoice,
  type PriorityKey,
} from "@/lib/restaurant/onboarding-copy";
import {
  LANGUAGE_OPTIONS,
  nextLanguageOnCountryChange,
  type PreferredLanguage,
} from "@/lib/restaurant/language";

type IconComponent = ComponentType<{ className?: string }>;

const CONCEPT_ICONS: Record<ConceptType, IconComponent> = {
  restaurant: UtensilsCrossed,
  bar: Martini,
  cafe: Coffee,
  bakery: Croissant,
  fast_casual: Zap,
  other: MoreHorizontal,
};

const PRIORITY_ICONS: Record<PriorityKey, IconComponent> = {
  margins: TrendingUp,
  food_cost: DollarSign,
  sales: BarChart3,
  inventory: Package,
  waste: Trash2,
  forecast: LineChart,
};

const TOTAL_STEPS = 4;

interface WizardState {
  conceptType: ConceptType | null;
  country: string | null;
  preferredLanguage: PreferredLanguage | null;
  /** True once the user has explicitly picked a language card — after
   *  that, changing the country must never override their choice. */
  languageTouched: boolean;
  locationCount: LocationCountBucket | null;
  posSystem: PosSystemChoice | null;
  priorities: PriorityKey[];
}

export function RestaurantOnboardingWizard({
  restaurantName,
}: {
  restaurantName: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>({
    conceptType: null,
    country: null,
    preferredLanguage: null,
    languageTouched: false,
    locationCount: null,
    posSystem: null,
    priorities: [],
  });

  const canAdvance = useMemo(() => {
    if (step === 1) return !!state.conceptType && !!state.country;
    if (step === 2) return !!state.locationCount && !!state.posSystem;
    if (step === 3) return true; // priorities are optional
    return true;
  }, [step, state]);

  function togglePriority(key: PriorityKey) {
    setState((s) => {
      const has = s.priorities.includes(key);
      if (has) {
        return { ...s, priorities: s.priorities.filter((p) => p !== key) };
      }
      if (s.priorities.length >= MAX_PRIORITIES) return s;
      return { ...s, priorities: [...s.priorities, key] };
    });
  }

  async function handleFinish() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/restaurant/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptType: state.conceptType,
          country: state.country,
          preferredLanguage: state.preferredLanguage,
          locationCount: state.locationCount,
          posSystem: state.posSystem,
          priorities: state.priorities,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error || "Could not finish setup. Please try again."
        );
      }
      setStep(4);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not finish setup."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const nextStepCards = getNextStepCards(state.posSystem ?? "unknown");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      {step <= TOTAL_STEPS && (
        <div className="mb-8 flex items-center gap-3">
          <Progress
            value={Math.min(step, TOTAL_STEPS)}
            max={TOTAL_STEPS}
            className="h-1.5"
          />
          <span className="text-muted-foreground shrink-0 text-xs font-medium">
            {Math.min(step, TOTAL_STEPS)}/{TOTAL_STEPS}
          </span>
        </div>
      )}

      {step === 1 && (
        <StepShell title={ONBOARDING_COPY.step1.title}>
          <p className="text-muted-foreground -mt-4 text-sm">
            {ONBOARDING_COPY.step1.subtitle.replace(
              "{restaurantName}",
              restaurantName
            )}
          </p>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">
              {ONBOARDING_COPY.step1.conceptLabel}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {CONCEPT_TYPE_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.value}
                  label={opt.label}
                  icon={CONCEPT_ICONS[opt.value]}
                  selected={state.conceptType === opt.value}
                  onClick={() =>
                    setState((s) => ({ ...s, conceptType: opt.value }))
                  }
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">
              {ONBOARDING_COPY.step1.countryLabel}
            </h3>
            <Select
              value={state.country ?? undefined}
              onValueChange={(v) =>
                setState((s) => ({
                  ...s,
                  country: v,
                  // Smart default: only auto-set language from the country
                  // while the user hasn't explicitly picked one themselves —
                  // the user's own choice always wins from then on.
                  preferredLanguage: nextLanguageOnCountryChange(
                    v,
                    s.languageTouched,
                    s.preferredLanguage
                  ),
                }))
              }
            >
              <SelectTrigger className="h-12 w-full text-base">
                <SelectValue
                  placeholder={ONBOARDING_COPY.step1.countryPlaceholder}
                />
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

          <div className="space-y-3">
            <h3 className="text-sm font-medium">
              {ONBOARDING_COPY.step1.languageLabel}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {LANGUAGE_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.value}
                  label={opt.label}
                  selected={state.preferredLanguage === opt.value}
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      preferredLanguage: opt.value,
                      languageTouched: true,
                    }))
                  }
                />
              ))}
            </div>
          </div>
        </StepShell>
      )}

      {step === 2 && (
        <StepShell title={ONBOARDING_COPY.step2.title}>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">
              {ONBOARDING_COPY.step2.locationsLabel}
            </h3>
            <div className="grid grid-cols-4 gap-3">
              {LOCATION_COUNT_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.value}
                  label={opt.label}
                  selected={state.locationCount === opt.value}
                  onClick={() =>
                    setState((s) => ({ ...s, locationCount: opt.value }))
                  }
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">
              {ONBOARDING_COPY.step2.posLabel}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {POS_SYSTEM_OPTIONS.map((opt) => (
                <SelectableCard
                  key={opt.value}
                  label={opt.label}
                  selected={state.posSystem === opt.value}
                  onClick={() =>
                    setState((s) => ({ ...s, posSystem: opt.value }))
                  }
                />
              ))}
            </div>
          </div>
        </StepShell>
      )}

      {step === 3 && (
        <StepShell title={ONBOARDING_COPY.step3.title}>
          <p className="text-muted-foreground -mt-4 text-sm">
            {ONBOARDING_COPY.step3.subtitle}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PRIORITY_OPTIONS.map((opt) => {
              const selected = state.priorities.includes(opt.value);
              const capReached =
                !selected && state.priorities.length >= MAX_PRIORITIES;
              return (
                <SelectableCard
                  key={opt.value}
                  label={opt.label}
                  icon={PRIORITY_ICONS[opt.value]}
                  selected={selected}
                  disabled={capReached}
                  onClick={() => togglePriority(opt.value)}
                />
              );
            })}
          </div>
        </StepShell>
      )}

      {step === 4 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
              <PartyPopper className="text-primary h-8 w-8" />
            </div>
            <Image
              src="/Milton_Logo.png"
              alt="Milton"
              width={32}
              height={32}
              className="opacity-70"
            />
            <h1 className="text-2xl font-semibold text-balance sm:text-3xl">
              {ONBOARDING_COPY.step4.heading.replace(
                "{restaurantName}",
                restaurantName
              )}
            </h1>
            <p className="text-muted-foreground text-sm">
              {ONBOARDING_COPY.step4.subtitle}
            </p>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-3">
            {nextStepCards.map((card, i) => (
              <Link
                key={card.key}
                href={card.href}
                className="group border-border bg-card hover:border-primary/50 hover:bg-accent/50 relative flex flex-col items-start gap-2 rounded-xl border-2 p-5 text-left transition-all"
              >
                {i === 0 && (
                  <span className="bg-primary text-primary-foreground absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    Recommended
                  </span>
                )}
                <span className="font-semibold">{card.title}</span>
                <span className="text-muted-foreground text-xs">
                  {card.description}
                </span>
                <span className="text-primary mt-auto flex items-center gap-1 text-sm font-medium">
                  {card.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>

          <Button
            variant="ghost"
            onClick={() => {
              router.push("/dashboard/restaurant");
              router.refresh();
            }}
          >
            Skip to dashboard
          </Button>
        </div>
      )}

      {step <= 3 && (
        <div className="mt-8 flex items-center justify-between gap-3">
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" />
              {ONBOARDING_COPY.nav.back}
            </Button>
          ) : (
            <span />
          )}

          {submitError && (
            <p className="text-destructive text-xs">{submitError}</p>
          )}

          {step < 3 ? (
            <Button
              disabled={!canAdvance}
              onClick={() => setStep((s) => s + 1)}
            >
              {ONBOARDING_COPY.nav.next}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button disabled={submitting} onClick={handleFinish}>
              {submitting
                ? ONBOARDING_COPY.nav.saving
                : ONBOARDING_COPY.nav.finish}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StepShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-8">
      <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
      {children}
    </div>
  );
}
