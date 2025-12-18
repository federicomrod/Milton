"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload,
  ArrowRight,
  FileText,
  Database,
  TrendingUp,
} from "lucide-react";

export function UploadInvitation() {
  const router = useRouter();

  return (
    <Card className="border-2 border-blue-200 shadow-lg">
      <CardHeader className="text-center pb-4">
        <div className="flex justify-center mb-4">
          <div className="rounded-full bg-blue-100 p-4">
            <Upload className="h-12 w-12 text-blue-600" />
          </div>
        </div>
        <CardTitle className="text-2xl md:text-3xl mb-2">
          Upload Your Financial Data
        </CardTitle>
        <CardDescription className="text-base">
          Connect your data sources to unlock powerful insights and analytics
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-100 p-1.5 mt-0.5">
              <FileText className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Bank Transactions</h3>
              <p className="text-sm text-muted-foreground">
                Upload your bank statements and transaction history
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-100 p-1.5 mt-0.5">
              <Database className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">CRM Data</h3>
              <p className="text-sm text-muted-foreground">
                Import your sales pipeline and deal information
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-100 p-1.5 mt-0.5">
              <TrendingUp className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Budget Files</h3>
              <p className="text-sm text-muted-foreground">
                Add your budget plans and forecasts for analysis
              </p>
            </div>
          </div>
        </div>
        <div className="pt-4">
          <Button
            onClick={() => router.push("/dashboard/upload")}
            className="w-full h-12 text-base"
            size="lg"
          >
            Go to Upload Page
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
