// components/restaurant/ComingSoonPage.tsx
//
// Shared "coming soon" frame for the restaurant cockpit's not-yet-built
// modules (Menu & Recipes, Ingredients, Supplier Invoices, Agents). Each
// caller passes a title, icon, blurb, and the planned-feature checklist.
//
// Visual style intentionally matches the live restaurant dashboard:
//   - same max-width container
//   - same heading scale
//   - same Back-to-cockpit affordance
//
// No data fetching, no client state — these pages exist only to signal
// product intent and prevent dead links in the navigation.

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ComingSoonPage({
  title,
  icon: Icon,
  tagline,
  description,
  planned,
  related,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  /** One-line summary right under the title. */
  tagline: string;
  /** 2-3 sentence longer explanation of what this module will do. */
  description: ReactNode;
  /** Bulleted list of concrete features that will land. */
  planned: string[];
  /** Optional links back to working surfaces (kept tiny, max ~3). */
  related?: { href: string; label: string }[];
}) {
  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="max-w-4xl space-y-6">
        <Link
          href="/dashboard/restaurant"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to cockpit
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Icon className="h-7 w-7 text-orange-500" />
              <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
              <Badge
                variant="outline"
                className="text-sm font-normal text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800"
              >
                Coming soon
              </Badge>
            </div>
            <p className="text-base text-muted-foreground">{tagline}</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-orange-500" />
              What this module will do
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-foreground/90 leading-relaxed">
              {description}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">
                Planned in the next milestones
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                {planned.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            {related && related.length > 0 && (
              <div className="pt-2 flex flex-wrap gap-2">
                {related.map((r) => (
                  <Button key={r.href} asChild size="sm" variant="outline">
                    <Link href={r.href}>{r.label}</Link>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
