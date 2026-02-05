import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader } from "@/components/management/admin-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, BarChart3, FileText, Table, ArrowRight } from "lucide-react";

async function getRecordCounts() {
  const supabase = await createClient();

  const [kpisResult, metricsResult, templatesResult, dataTablesResult] =
    await Promise.all([
      supabase.from("kpis").select("id", { count: "exact", head: true }),
      supabase.from("metrics").select("id", { count: "exact", head: true }),
      supabase
        .from("business_model_templates")
        .select("key", { count: "exact", head: true }),
      supabase.from("data_tables").select("id", { count: "exact", head: true }),
    ]);

  return {
    kpis: kpisResult.count || 0,
    metrics: metricsResult.count || 0,
    templates: templatesResult.count || 0,
    dataTables: dataTablesResult.count || 0,
  };
}

export default async function ManagementDashboard() {
  const counts = await getRecordCounts();

  const sections = [
    {
      title: "KPIs",
      description: "Manage key performance indicators",
      icon: Target,
      href: "/management/kpis",
      count: counts.kpis,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Metrics",
      description: "Manage business metrics",
      icon: BarChart3,
      href: "/management/metrics",
      count: counts.metrics,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      title: "Templates",
      description: "Manage business model templates",
      icon: FileText,
      href: "/management/templates",
      count: counts.templates,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "Data Tables",
      description: "Manage data table definitions",
      icon: Table,
      href: "/management/data-tables",
      count: counts.dataTables,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
  ];

  return (
    <div>
      <AdminHeader
        title="Content Management"
        description="Manage KPIs, metrics, business model templates, and data tables"
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.title} className="relative overflow-hidden">
              <CardHeader>
                <div
                  className={`${section.bgColor} w-12 h-12 rounded-lg flex items-center justify-center mb-4`}
                >
                  <Icon className={`h-6 w-6 ${section.color}`} />
                </div>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold">{section.count}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {section.count === 1 ? "record" : "records"}
                    </p>
                  </div>
                  <Link href={section.href}>
                    <Button variant="ghost" size="icon">
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
