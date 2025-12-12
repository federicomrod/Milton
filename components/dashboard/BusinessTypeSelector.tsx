'use client';

import React from 'react';
import { BUSINESS_TYPES, type BusinessTypeId } from '@/lib/business-types';
import { useBusinessContext } from '@/lib/business-context';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function BusinessTypeSelector() {
  const { setBusinessType } = useBusinessContext();

  const handleSelect = (id: BusinessTypeId) => {
    setBusinessType(id);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/40 px-4">
      <div className="max-w-3xl w-full space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            What type of business are you running?
          </h1>
          <p className="text-sm text-muted-foreground">
            Milton tailors KPIs, dashboards, and AI insights based on your business model.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {BUSINESS_TYPES.map((type) => (
            <Card
              key={type.id}
              className="flex flex-col justify-between border-border hover:border-primary/70 transition-colors cursor-pointer"
              onClick={() => handleSelect(type.id)}
            >
              <CardHeader className="space-y-2">
                <CardTitle className="text-base font-semibold">{type.label}</CardTitle>
                <CardDescription className="text-xs">{type.description}</CardDescription>
                {type.tagline && (
                  <p className="text-xs text-muted-foreground italic">{type.tagline}</p>
                )}
              </CardHeader>
              <div className="px-4 pb-4">
                <Button
                  type="button"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelect(type.id);
                  }}
                >
                  Choose {type.shortLabel ?? type.label}
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          You can change this later in your settings or data model configuration.
        </p>
      </div>
    </div>
  );
}

