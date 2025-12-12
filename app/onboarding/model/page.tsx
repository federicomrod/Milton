'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import DataModelBuilder from '@/components/dashboard/DataModelBuilder';

export default function OnboardingModelPage() {
  const router = useRouter();

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connect & model your data</h1>
        <p className="text-sm text-muted-foreground">
          Upload your files and refine the data model for your business. When you are
          happy with the tables and relationships, continue to choose your key KPIs.
        </p>
      </div>

      <div className="rounded-2xl border bg-background p-4 md:p-6">
        <DataModelBuilder />
      </div>

      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/onboarding')}
        >
          Back to chat
        </Button>
        <Button
          type="button"
          onClick={() => router.push('/onboarding/kpis')}
        >
          Next: Choose KPIs
        </Button>
      </div>
    </main>
  );
}

