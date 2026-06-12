"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Database } from "lucide-react";

export default function ModelPage() {
  return (
    <main className="min-h-screen bg-background max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="rounded-2xl border bg-background p-6 md:p-8">
        {/* Temporary restaurant-pivot baseline stabilization. */}
        {/* TODO(restaurant-pivot): re-enable model builder after ingestion paths are consolidated. */}
        <h1 className="text-xl font-semibold mb-2">Data Model (Paused)</h1>
        <p className="text-sm text-muted-foreground mb-6">
          The old Data Model Builder is currently paused during the restaurant
          pivot.
        </p>
        <p className="text-sm text-foreground mb-6">
          Use Data Uploads instead.
        </p>

        <Button asChild className="gap-2">
          <Link href="/dashboard/data">
            <Database className="h-4 w-4" />
            Go To Data Uploads
          </Link>
        </Button>
      </div>
    </main>
  );
}
