"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface Template {
  key: string;
  name: string;
}

interface DataTableTemplatesCellProps {
  tableId: string;
}

export function DataTableTemplatesCell({
  tableId,
}: DataTableTemplatesCellProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await fetch(
          `/api/admin/data-tables/templates/${tableId}`
        );
        if (response.ok) {
          const data = await response.json();
          setTemplates(data);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error("Failed to fetch templates for table:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, [tableId]);

  if (loading) {
    return <span className="text-muted-foreground text-sm">Loading...</span>;
  }

  if (error || templates.length === 0) {
    return <span className="text-muted-foreground text-sm">None</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {templates.slice(0, 2).map((template) => (
        <Badge key={template.key} variant="secondary" className="text-xs">
          {template.name}
        </Badge>
      ))}
      {templates.length > 2 && (
        <Badge variant="outline" className="text-xs">
          +{templates.length - 2} more
        </Badge>
      )}
    </div>
  );
}
