"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { KpiSelectionStep } from "@/components/onboarding/KpiSelectionStep";
import MiltonChat from "@/app/onboarding/components/MiltonChat";
import DataModelBuilder from "@/components/dashboard/DataModelBuilder";
import { DataSourceSelectionStep } from "@/components/onboarding/DataSourceSelectionStep";

type OnboardingStep = "chat" | "kpis" | "data-sources" | "model";

export function OnboardingWizard() {
  const [step, setStep] = React.useState<OnboardingStep>("chat");

  const goToNext = () => {
    setStep((prev) => {
      if (prev === "chat") return "kpis";
      if (prev === "kpis") return "data-sources";
      if (prev === "data-sources") return "model";
      return "model";
    });
  };

  const goToPrev = () => {
    setStep((prev) => {
      if (prev === "model") return "data-sources";
      if (prev === "data-sources") return "kpis";
      if (prev === "kpis") return "chat";
      return "chat";
    });
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-muted-foreground">
        <span
          className={step === "chat" ? "font-semibold text-foreground" : ""}
        >
          1. Tell Milton about your business
        </span>
        <span>›</span>
        <span
          className={step === "kpis" ? "font-semibold text-foreground" : ""}
        >
          2. Choose your key KPIs
        </span>
        <span>›</span>
        <span
          className={
            step === "data-sources" ? "font-semibold text-foreground" : ""
          }
        >
          3. Declare your data sources
        </span>
        <span>›</span>
        <span
          className={step === "model" ? "font-semibold text-foreground" : ""}
        >
          4. Connect & model your data
        </span>
      </div>

      {/* Step content */}
      <div className="rounded-2xl border bg-background p-4 md:p-6 space-y-4">
        {step === "chat" && (
          <>
            <h1 className="text-xl font-semibold">
              Tell Milton about your business
            </h1>
            <p className="text-sm text-muted-foreground">
              Use this chat to explain how your business works, what services
              you offer, and which metrics you care about. Milton will use this
              context when proposing your data model and KPIs.
            </p>
            <div className="mt-4">
              <MiltonChat
                onFinish={goToNext}
                messages={[]}
                setMessages={() => {}}
              />
            </div>
          </>
        )}

        {step === "kpis" && (
          <>
            <KpiSelectionStep />
          </>
        )}

        {step === "data-sources" && (
          <DataSourceSelectionStep onComplete={goToNext} />
        )}

        {step === "model" && (
          <>
            <h1 className="text-xl font-semibold">Connect & model your data</h1>
            <p className="text-sm text-muted-foreground">
              Upload your files and refine the data model. Once you are happy
              with the tables and relationships, you're ready to go!
            </p>
            <div className="mt-4">
              <DataModelBuilder />
            </div>
          </>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={step === "chat"}
          onClick={goToPrev}
        >
          Back
        </Button>

        {step !== "model" ? (
          <Button type="button" onClick={goToNext}>
            {step === "chat" && "Next: Choose KPIs"}
            {step === "kpis" && "Next: Declare data sources"}
            {step === "data-sources" && "Next: Connect & model your data"}
          </Button>
        ) : step === "model" ? (
          <Button
            type="button"
            onClick={() => {
              window.location.href = "/dashboard";
            }}
          >
            Finish onboarding
          </Button>
        ) : null}
      </div>
    </div>
  );
}
