// components/dashboard/reports/ReportPreview.tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportConfig } from "@/lib/types/report";

interface ReportPreviewProps {
  config: ReportConfig;
}

export function ReportPreview({ config }: ReportPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Report Preview</CardTitle>
        <CardDescription>
          Preview of your report structure - functionality yet to be developed
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Cover Slide */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border-l-4 border-blue-500">
            <div>
              <h3 className="font-semibold">Cover Slide</h3>
              <p className="text-sm text-gray-600">
                {config.title} • {config.companyName}
              </p>
            </div>
            <Badge variant="secondary">Always Included</Badge>
          </div>

          {/* Placeholder for future sections */}
          <div className="p-4 bg-gray-50 rounded-lg border-l-4 border-gray-300">
            <div className="text-center">
              <h3 className="font-semibold text-gray-700 mb-2">
                Report Sections
              </h3>
              <p className="text-sm text-gray-600">
                Section selection and detailed preview will be available when
                this feature is fully developed.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
