"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import DataModelBuilder from "@/components/dashboard/DataModelBuilder";
import { updateOnboardingStatus } from "@/lib/onboarding-status";
import { createClient } from "@/lib/supabase/client";

export default function OnboardingModelPage() {
  const router = useRouter();
  const [isFinishing, setIsFinishing] = useState(false);

  // Ensure canonical_model is copied from template to business_models on page load
  useEffect(() => {
    const ensureCanonicalModel = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return;

        // Get company
        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (!company) return;

        // Get business model to check if canonical_model exists
        const { data: businessModel, error: fetchError } = await supabase
          .from("business_models")
          .select("canonical_model, business_type")
          .eq("company_id", company.id)
          .single();

        if (fetchError || !businessModel) {
          console.log("[OnboardingModelPage] No business model found yet");
          return;
        }

        // If canonical_model already exists, we're good
        if (businessModel.canonical_model) {
          console.log("[OnboardingModelPage] canonical_model already exists");
          return;
        }

        // If no canonical_model but we have business_type, copy from template
        if (businessModel.business_type) {
          console.log(
            "[OnboardingModelPage] Copying canonical_model from template..."
          );

          const { data: template, error: templateError } = await supabase
            .from("business_model_templates")
            .select("required_tables_data, required_relationships")
            .eq("key", businessModel.business_type)
            .single();

          if (templateError) {
            // Only log actual errors, not "not found" cases
            if (templateError.code !== "PGRST116") {
              console.error(
                "[OnboardingModelPage] Template fetch error:",
                templateError.message || templateError
              );
            } else {
              console.log(
                `[OnboardingModelPage] No template found for business_type: ${businessModel.business_type}`
              );
            }
            return;
          }

          if (!template) {
            console.log(
              `[OnboardingModelPage] Template not found for business_type: ${businessModel.business_type}`
            );
            return;
          }

          // Transform template data to ModelProposal format
          // Template structure: { table_name, fields: string[], required_fields: string[], description }
          const recommendedTables = (template.required_tables_data || []).map(
            (table: any) => {
              const tableName = table.name || table.table_name;
              const fieldNames = table.fields || [];
              const requiredFields = table.required_fields || [];

              const fields = fieldNames.map((fieldName: string) => {
                // Check if field is required (in required_fields array)
                const isRequired = requiredFields.includes(fieldName);

                return {
                  name: fieldName,
                  nullable: !isRequired,
                };
              });

              return {
                name: tableName,
                fields,
              };
            }
          );

          const relationships = (template.required_relationships || []).map(
            (rel: any) => ({
              from: rel.from || `${rel.from_table}.${rel.from_field}`,
              to: rel.to || `${rel.to_table}.${rel.to_field}`,
              type: rel.type,
            })
          );

          const canonicalModel = {
            businessType: businessModel.business_type,
            recommendedTables,
            relationships,
          };

          // Save canonical_model to business_models
          const { error: updateError } = await supabase
            .from("business_models")
            .update({ canonical_model: canonicalModel })
            .eq("company_id", company.id);

          if (updateError) {
            console.error(
              "[OnboardingModelPage] Failed to save canonical_model:",
              updateError
            );
          } else {
            console.log(
              "[OnboardingModelPage] Successfully copied canonical_model from template"
            );
          }
        }
      } catch (error) {
        console.error(
          "[OnboardingModelPage] Error ensuring canonical_model:",
          error
        );
      }
    };

    ensureCanonicalModel();
  }, []);

  const handleContinue = async () => {
    setIsFinishing(true);
    try {
      console.log("[Model] Continuing to uploads...");

      // Update onboarding status to upload
      await updateOnboardingStatus("upload");

      // Redirect to uploads
      console.log("[Model] Redirecting to uploads...");
      router.push("/onboarding/upload");
    } catch (error) {
      console.error("[Model] Error continuing onboarding:", error);
      alert("An error occurred. Please try again.");
      setIsFinishing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Customize Your Data Model</h1>
        <p className="text-sm text-muted-foreground">
          Review and customize your data model. You can adjust tables, fields,
          and relationships to match your business needs.
        </p>
      </div>

      <div className="rounded-2xl border bg-background p-4 md:p-6">
        <DataModelBuilder isOnboarding={true} />
      </div>

      <div className="flex justify-between items-center pt-6 border-t border-border">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/onboarding/chat")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button type="button" onClick={handleContinue} disabled={isFinishing}>
          {isFinishing ? "Continuing..." : "Continue"}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </main>
  );
}
