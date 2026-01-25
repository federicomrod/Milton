"use client";

import DataModelBuilder from "@/components/dashboard/DataModelBuilder";

export default function ModelPage() {
  return (
    <main className="min-h-screen bg-background max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Data Model</h1>
        <p className="text-sm text-muted-foreground">
          View and explore your canonical data model. This shows the structure
          of your business data with tables, fields, and relationships.
        </p>
      </div>

      <div className="rounded-2xl border bg-background p-4 md:p-6">
        <DataModelBuilder />
      </div>
    </main>
  );
}
