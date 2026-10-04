"use client";

// components/restaurant/connect-data/ConnectDataOptions.tsx
//
// Client UI for the "Connect your data" screen. All text comes from
// lib/restaurant/connect-data-copy.ts. Link actions go to the existing
// upload tab; request actions POST to /api/restaurant/data-source-requests
// and then confirm — nothing here pretends to be connected.

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CONNECT_DATA_COPY as COPY,
  CONNECT_OPTIONS,
  DASHBOARD_PATH,
  MAX_REQUEST_DETAILS,
  OTHER_QUICK_PICKS,
  type ConnectAction,
  type ConnectOption,
  type DataSourceRequestSource,
} from "@/lib/restaurant/connect-data-copy";

type RequestAction = Extract<ConnectAction, { kind: "request" }>;

function RequestControl({
  action,
  withPicks,
}: {
  action: RequestAction;
  withPicks?: boolean;
}) {
  const [open, setOpen] = useState(!!withPicks);
  const [note, setNote] = useState("");
  const [pick, setPick] = useState<"square" | "toast" | "other">("other");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  const send = async () => {
    const source: DataSourceRequestSource = withPicks ? pick : action.source;
    if (withPicks && !note.trim() && pick === "other") return;
    setState("sending");
    try {
      const res = await fetch("/api/restaurant/data-source-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          ...(note.trim() ? { details: note.trim() } : {}),
        }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  };

  if (state === "sent") {
    return <p className="text-sm text-green-700">{COPY.requestSent}</p>;
  }

  return (
    <div className="space-y-2">
      {action.badge && <Badge variant="secondary">{action.badge}</Badge>}
      {withPicks && (
        <div className="flex flex-wrap gap-2">
          {OTHER_QUICK_PICKS.map((p) => (
            <Button
              key={p.value}
              type="button"
              size="sm"
              variant={pick === p.value ? "default" : "outline"}
              onClick={() => setPick(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
      {open && (
        <Textarea
          value={note}
          maxLength={MAX_REQUEST_DETAILS}
          placeholder={
            withPicks ? COPY.otherTextPlaceholder : COPY.notePlaceholder
          }
          aria-label={withPicks ? COPY.otherTextLabel : COPY.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      {state === "error" && (
        <p className="text-sm text-destructive">{COPY.requestError}</p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={state === "sending"}
        onClick={() => {
          if (action.note && !open) {
            setOpen(true);
            return;
          }
          void send();
        }}
      >
        {state === "sending"
          ? "Sending…"
          : withPicks
            ? COPY.otherSubmit
            : action.note && open
              ? COPY.sendRequest
              : action.label}
      </Button>
    </div>
  );
}

function OptionCard({
  option,
  highlighted,
}: {
  option: ConnectOption;
  highlighted: boolean;
}) {
  return (
    <Card className={cn(highlighted && "border-primary ring-1 ring-primary")}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{option.title}</CardTitle>
          {highlighted && <Badge>{COPY.recommended}</Badge>}
        </div>
        <CardDescription>{option.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {option.actions.map((action) =>
          action.kind === "link" ? (
            <div key={action.id}>
              <Button asChild>
                <Link href={action.href}>{action.label}</Link>
              </Button>
            </div>
          ) : (
            <RequestControl
              key={action.id}
              action={action}
              withPicks={option.key === "other"}
            />
          )
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectDataOptions({
  highlightedKey,
}: {
  highlightedKey: ConnectOption["key"] | null;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">{COPY.header}</h1>
        <p className="text-sm text-muted-foreground">{COPY.subheader}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {CONNECT_OPTIONS.map((o) => (
          <OptionCard
            key={o.key}
            option={o}
            highlighted={highlightedKey === o.key}
          />
        ))}
      </div>
      <div>
        <Link
          href={DASHBOARD_PATH}
          className="text-sm text-primary hover:underline"
        >
          {COPY.skip}
        </Link>
      </div>
    </div>
  );
}
