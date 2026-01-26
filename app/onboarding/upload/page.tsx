"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ModelTableListView from "@/components/dashboard/ModelTableListView";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { updateOnboardingStatus } from "@/lib/onboarding-status";
import { createClient } from "@/lib/supabase/client";
import { ModelProposal } from "@/lib/model/transform";

export default function OnboardingUploadPage() {
  const router = useRouter();
  const [model, setModel] = useState<ModelProposal | null>(null);

  // Load model from business_models
  useEffect(() => {
    const loadModel = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (company) {
          const { data } = await supabase
            .from("business_models")
            .select("canonical_model")
            .eq("company_id", company.id)
            .single();

          if (data?.canonical_model) {
            setModel(data.canonical_model as ModelProposal);
          }
        }
      } catch (error) {
        console.error("[OnboardingUpload] Error loading model:", error);
      }
    };
    loadModel();
  }, []);

  const handleContinue = async () => {
    // Update onboarding status to kpi_selection
    await updateOnboardingStatus("kpi_selection");
    // Redirect to KPI selection
    router.push("/onboarding/kpi-selection");
  };

  return (
    <div className="min-h-screen bg-background max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">
            Upload Your Data
          </h1>
          <p className="text-muted-foreground mt-2">
            Upload files that match your data model. We'll help you map columns
            to the correct tables and fields. You can skip this step and upload
            later if you prefer.
          </p>
        </div>

        <div className="space-y-6">
          <ModelTableListView model={model} />
        </div>

        <div className="flex justify-between items-center mt-8 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => router.push("/onboarding/model")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Model
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={handleContinue}>
              Continue to KPI Selection
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <p className="text-xs text-muted-foreground">
              You can upload files here or continue
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
