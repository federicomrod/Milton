"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { FileText, Database, DollarSign } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getUploadedFilesSummary } from "@/lib/data-service";

interface UploadedFile {
  type: "transactions" | "deals" | "budget";
  label: string;
  count: number;
  icon: any;
  color: string;
}

const FILE_TYPE_MAP: Record<
  string,
  { type: "transactions" | "deals" | "budget"; icon: any; color: string }
> = {
  transactions: {
    type: "transactions",
    icon: DollarSign,
    color: "bg-green-100 text-green-800",
  },
  crm_deals: {
    type: "deals",
    icon: FileText,
    color: "bg-blue-100 text-blue-800",
  },
  budgets: {
    type: "budget",
    icon: Database,
    color: "bg-purple-100 text-purple-800",
  },
};

export function UploadedFilesDisplay() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);

  const checkUploadedFiles = async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUploadedFiles([]);
        setLoading(false);
        return;
      }

      const summaries = await getUploadedFilesSummary(supabase, user.id);
      const files: UploadedFile[] = summaries
        .filter((summary) => summary.count > 0)
        .map((summary) => {
          const fileType = FILE_TYPE_MAP[summary.name];
          if (!fileType) return null;
          return {
            type: fileType.type,
            label: summary.label,
            count: summary.count,
            icon: fileType.icon,
            color: fileType.color,
          };
        })
        .filter((file): file is UploadedFile => file !== null);

      setUploadedFiles(files);
    } catch (error) {
      console.error("Error checking uploaded files:", error);
      setUploadedFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkUploadedFiles();

    // Check periodically for changes
    const interval = setInterval(checkUploadedFiles, 5000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  if (uploadedFiles.length === 0) {
    return (
      <div className="text-sm text-gray-500 mt-2">No files uploaded yet</div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="text-sm font-medium text-gray-700">
        Currently loaded files:
      </div>
      <div className="flex flex-wrap gap-2">
        {uploadedFiles.map((file) => {
          const Icon = file.icon;
          return (
            <Badge
              key={file.type}
              variant="secondary"
              className={`${file.color} flex items-center gap-1`}
            >
              <Icon className="h-3 w-3" />
              {file.label} ({file.count}{" "}
              {file.type === "budget" ? "file" : "records"})
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
