"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useToast } from "../ui/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import {
  proposalToGraph,
  ModelProposal,
  addField,
  removeField,
  renameField,
  addRelationship,
} from "@/lib/model/transform";
import {
  listCustomDatasets,
  deleteCustomDataset,
} from "@/lib/model/dataset-service";
import ColumnEditor from "@/components/dashboard/ColumnEditor";
import { useBusinessContext } from "@/lib/business-context";
import { callBusinessModelAnalyzer } from "@/lib/ai/business-model-analyzer-client";

import { miltonEventsAPI } from "@/lib/milton-events";
import {
  getBusinessModelTemplates,
  BusinessTypeDefinition,
} from "@/lib/business-model-templates";

// Temporary type aliases to satisfy TypeScript when using dynamic require for ReactFlow
type Node = any;
type Edge = any;
type Connection = any;

// Optional ReactFlow imports - gracefully handle missing package
let ReactFlow: any = null;
let Background: any = null;
let Controls: any = null;
let MiniMap: any = null;
let addEdge: any = null;
let applyNodeChanges: any = null;
let applyEdgeChanges: any = null;

try {
  const reactflowModule = require("reactflow");
  ReactFlow = reactflowModule.default || reactflowModule.ReactFlow;
  Background = reactflowModule.Background;
  Controls = reactflowModule.Controls;
  MiniMap = reactflowModule.MiniMap;
  addEdge = reactflowModule.addEdge;
  applyNodeChanges = reactflowModule.applyNodeChanges;
  applyEdgeChanges = reactflowModule.applyEdgeChanges;
  require("reactflow/dist/style.css");
} catch (e) {
  console.warn("reactflow not installed. Run: npm install reactflow");
}

// Fitness Studio default model - used when business type is fitness_studio and no model exists
const FITNESS_STUDIO_DEFAULT_MODEL: ModelProposal = {
  businessType: "fitness_studio",
  recommendedTables: [
    {
      name: "Customers",
      fields: [
        { name: "customer_id", type: "string", primaryKey: true },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
        { name: "phone", type: "string", nullable: true },
        { name: "join_date", type: "date" },
        { name: "status", type: "string" }, // active / inactive / cancelled
      ],
    },
    {
      name: "Classes",
      fields: [
        { name: "class_id", type: "string", primaryKey: true },
        { name: "class_name", type: "string" },
        { name: "category", type: "string" }, // yoga / pilates / fitness
        { name: "capacity", type: "integer" },
        { name: "duration_minutes", type: "integer" },
        { name: "price", type: "number" },
      ],
    },
    {
      name: "Instructors",
      fields: [
        { name: "instructor_id", type: "string", primaryKey: true },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
        { name: "hourly_rate", type: "number" },
        { name: "specialization", type: "string", nullable: true },
      ],
    },
    {
      name: "Bookings",
      fields: [
        { name: "booking_id", type: "string", primaryKey: true },
        {
          name: "customer_id",
          type: "string",
          references: { table: "Customers", field: "customer_id" },
        },
        {
          name: "class_id",
          type: "string",
          references: { table: "Classes", field: "class_id" },
        },
        {
          name: "instructor_id",
          type: "string",
          references: { table: "Instructors", field: "instructor_id" },
        },
        { name: "booking_time", type: "date" },
        { name: "status", type: "string" }, // booked / attended / cancelled / no-show
      ],
    },
    {
      name: "Payments",
      fields: [
        { name: "payment_id", type: "string", primaryKey: true },
        {
          name: "customer_id",
          type: "string",
          references: { table: "Customers", field: "customer_id" },
        },
        {
          name: "booking_id",
          type: "string",
          nullable: true,
          references: { table: "Bookings", field: "booking_id" },
        },
        { name: "amount", type: "number" },
        { name: "payment_date", type: "date" },
        { name: "payment_method", type: "string", nullable: true },
      ],
    },
  ],
  relationships: [
    { from: "Bookings.customer_id", to: "Customers.customer_id" },
    { from: "Bookings.class_id", to: "Classes.class_id" },
    { from: "Bookings.instructor_id", to: "Instructors.instructor_id" },
    { from: "Payments.customer_id", to: "Customers.customer_id" },
    { from: "Payments.booking_id", to: "Bookings.booking_id" },
  ],
};

interface DataModelBuilderProps {
  isOnboarding?: boolean;
}

export default function DataModelBuilder({
  isOnboarding = false,
}: DataModelBuilderProps) {
  const [model, setModel] = useState<ModelProposal | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [isAiProposing, setIsAiProposing] = useState(false); // Track AI model generation
  const [businessModelTemplates, setBusinessModelTemplates] = useState<
    BusinessTypeDefinition[]
  >([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null); // Store file for ingestion
  const [isProcessing, setIsProcessing] = useState(false); // Track upload progress
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [dbBusinessType, setDbBusinessType] = useState<string | null>(null);

  const { toast } = useToast();
  const { businessType } = useBusinessContext();

  // Load business type from database
  useEffect(() => {
    (async () => {
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
          const { data: businessModel } = await supabase
            .from("business_models")
            .select("business_type")
            .eq("company_id", company.id)
            .single();

          if (businessModel?.business_type) {
            setDbBusinessType(businessModel.business_type);
            setSelectedModel(businessModel.business_type);
          }
        }
      } catch (error) {
        console.error(
          "[DataModelBuilder] Error fetching business type:",
          error
        );
      }
    })();
  }, []);

  const handleModelChange = (value: string) => {
    setSelectedModel(value);
    console.log("[DataModelBuilder] Selected business model:", value);
  };

  const handleGenerateDashboard = () => {
    const model = dbBusinessType || selectedModel || "";
    miltonEventsAPI.publish("dashboard.generate", { businessModel: model });
    console.log("[DataModelBuilder] Dashboard generation requested for", model);
  };

  const handleUploadData = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Store file for later reference
    setUploadedFile(file);

    setIsProcessing(true);

    try {
      console.log("[DataModelBuilder] Uploading file:", file.name);

      // Infer dataset type from file name
      let datasetType: "bank" | "crm" | "budget" = "bank";
      const fileName = file.name.toLowerCase();

      if (
        fileName.includes("crm") ||
        fileName.includes("deal") ||
        fileName.includes("sales")
      ) {
        datasetType = "crm";
      } else if (fileName.includes("budget")) {
        datasetType = "budget";
      } else if (
        fileName.includes("transaction") ||
        fileName.includes("bank")
      ) {
        datasetType = "bank";
      }

      // Call unified ingestion API
      const formData = new FormData();
      formData.append("file", file);
      formData.append("datasetType", datasetType);
      formData.append("mode", "append"); // Model Builder always appends

      const res = await fetch("/api/data/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText);
      }

      const result = await res.json();
      console.log(
        `[DataModelBuilder] Successfully uploaded ${result.insertedCount} rows`
      );

      // Refresh data status
      document.dispatchEvent(new CustomEvent("data-status:refresh"));

      // Update model to reflect new data
      await refreshDatasets();

      toast({
        title: "File uploaded successfully",
        description: `Uploaded ${result.insertedCount} rows to ${datasetType} table.`,
      });
    } catch (err) {
      console.error("[DataModelBuilder] Upload failed:", err);
      toast({
        title: "Upload failed",
        description: (err as Error)?.message || "Failed to upload file.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      e.target.value = "";
    }
  };

  const refreshDatasets = async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    try {
      const rows = await listCustomDatasets(user.id);
      setDatasets(rows || []);
    } catch (e: any) {
      // Silently handle errors - table might not exist yet or user might not have datasets
      // Only log if it's not a "table doesn't exist" type error
      if (
        e?.code !== "42P01" &&
        e?.message?.includes("does not exist") === false
      ) {
        console.warn(
          "[DataModelBuilder] Failed to load datasets:",
          e?.message || e
        );
      }
      setDatasets([]);
    }
  };

  const handlePreviewDataset = (ds: any) => {
    // TODO: Implement dataset preview without client-side parsing
    console.log("[DataModelBuilder] Preview dataset:", ds.dataset_name);
    toast({
      title: "Preview not available",
      description: "Dataset preview will be implemented in a future update.",
    });
  };

  const handleReplaceDataset = (ds: any) => {
    // TODO: Implement dataset replacement flow
    console.log("[DataModelBuilder] Replace dataset:", ds.dataset_name);
    toast({
      title: "Replace not available",
      description:
        "Dataset replacement will be implemented in a future update.",
    });
  };

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedTable(node.data.label);
  }, []);

  // Load model from Supabase or localStorage
  useEffect(() => {
    async function loadModel() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let loaded: ModelProposal | null = null;
      if (user) {
        // Get company for user
        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (company) {
          // First, try to load from canonical_model in business_models table
          const { data } = await supabase
            .from("business_models")
            .select("canonical_model, model_json")
            .eq("company_id", company.id)
            .single();

          if (data?.canonical_model) {
            loaded = data.canonical_model as ModelProposal;
            console.log("[DataModelBuilder] Loaded model from canonical_model");
          } else if (data?.model_json) {
            // Fall back to deprecated model_json
            loaded = data.model_json as ModelProposal;
            console.log(
              "[DataModelBuilder] Loaded model from model_json (deprecated)"
            );
          }
        }
      }

      if (!loaded) {
        const local = localStorage.getItem("milton-model");
        if (local) {
          try {
            loaded = JSON.parse(local);
            console.log("[DataModelBuilder] Loaded model from localStorage");
          } catch (e) {
            console.error("Failed to parse localStorage model JSON", e);
          }
        }
      }

      // If still no model, use fitness default if business type is fitness_studio
      if (!loaded && businessType === "fitness_studio") {
        console.log(
          "[DataModelBuilder] No existing model found, using fitness studio default"
        );
        loaded = FITNESS_STUDIO_DEFAULT_MODEL;
      }

      if (loaded) setModel(loaded);
      refreshDatasets();
    }
    loadModel();
  }, [businessType]);

  // Fetch business model templates from database
  useEffect(() => {
    async function fetchTemplates() {
      try {
        const templates = await getBusinessModelTemplates();
        setBusinessModelTemplates(templates);
      } catch (error) {
        console.error(
          "[DataModelBuilder] Failed to fetch business model templates:",
          error
        );
      }
    }
    fetchTemplates();
  }, []);

  // Listen for model updates
  useEffect(() => {
    const onUpdated = () => refreshDatasets();
    window.addEventListener("model:updated", onUpdated);
    return () => window.removeEventListener("model:updated", onUpdated);
  }, []);

  // Convert proposal to graph
  useEffect(() => {
    if (!model) return;
    const graph = proposalToGraph(model);
    // Highlight linked nodes
    // const linkedBySheet = new Set(
    //   datasets
    //     .map((d) => d.source_meta?.sheetName?.toLowerCase())
    //     .filter(Boolean)
    // )
    const linkedTableMeta = new Map<
      string,
      { datasetId?: string; datasetName?: string }
    >();
    model.recommendedTables?.forEach((tbl) => {
      const normalizedName =
        typeof tbl.name === "string" ? tbl.name.toLowerCase() : "";
      if ((tbl as any).isLinked && normalizedName) {
        linkedTableMeta.set(normalizedName, {
          datasetId: (tbl as any).linkedDatasetId,
          datasetName: (tbl as any).linkedMeta?.datasetName,
        });
      }
    });
    // const datasetById = new Map(datasets.map((d) => [d.id, d]))
    // const recentLinked = (typeof window !== 'undefined' && (window as any).__recentLinkedTable) ? String((window as any).__recentLinkedTable) : ''
    const mappedNodes: Node[] = graph.nodes.map((n) => {
      const normalizedLabel = n.label.toLowerCase();
      // Find the corresponding table in the model
      const tbl = model.recommendedTables?.find(
        (t) =>
          typeof t.name === "string" && t.name.toLowerCase() === normalizedLabel
      ) as any;
      const metadata = tbl?.linkedMeta;
      // New logic: isLinked and tooltipText derive directly from model data
      const isLinked = !!tbl?.isLinked;
      const tooltipText = tbl?.linkedMeta?.datasetName || metadata?.datasetName;
      const isSelected = selectedTable === n.table;
      return {
        id: n.id,
        data: {
          label: (
            <div className="relative group text-sm">
              <span className="flex items-center">
                {n.label}
                {isLinked && <span className="ml-1">📎</span>}
              </span>
              {isLinked && (
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-gray-800 text-white text-xs p-1 rounded shadow-md z-50">
                  Linked: {tooltipText || "Dataset"}
                </div>
              )}
            </div>
          ),
        },
        position: n.position || { x: 0, y: 0 },
        style: {
          background: isSelected ? "#dbeafe" : isLinked ? "#e8ffe8" : "#fff",
          border: isLinked ? "2px solid #22c55e" : "1px solid #ccc",
          borderRadius: 6,
          padding: 4,
          fontSize: 12,
          boxShadow: isLinked ? "0 0 12px rgba(34,197,94,0.5)" : "none",
          transition: "all 0.4s ease-in-out",
        },
      };
    });
    const mappedEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: "#2563eb" },
    }));
    setNodes(mappedNodes);
    setEdges(mappedEdges);
  }, [model, selectedTable]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!model) return;
      const fromTable = nodes.find((n) => n.id === connection.source)?.data
        .label;
      const toTable = nodes.find((n) => n.id === connection.target)?.data.label;
      if (fromTable && toTable) {
        const updated = addRelationship(model, {
          from: `${fromTable}.id`,
          to: `${toTable}.id`,
          type: "one-to-many",
        });
        setModel(updated);
      }
    },
    [model, nodes]
  );

  const onNodesChange = useCallback((changes: any) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: any) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const handleSave = async () => {
    if (!model) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        // Get company for user
        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (company) {
          // Save to canonical_model in business_models table (preferred)
          const { error } = await supabase
            .from("business_models")
            .update({
              canonical_model: model,
              model_json: model, // Keep for backwards compatibility (deprecated)
            })
            .eq("company_id", company.id);

          if (error) {
            console.error("Failed to save model to business_models:", error);
          }
        }
      }
      localStorage.setItem("milton-model", JSON.stringify(model));
      window.dispatchEvent(new Event("model:updated"));
      toast({
        title: "Model saved",
        description: "Your data model was saved successfully.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Apply a ModelProposal to the builder state
  const applyModelProposal = (proposal: ModelProposal) => {
    console.log("[DataModelBuilder] Applying AI-generated model proposal");

    // Update the model state
    setModel(proposal);

    // Convert the proposal to ReactFlow nodes/edges
    const graph = proposalToGraph(proposal);
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: "default",
        position: n.position,
        data: { label: n.label },
      }))
    );
    setEdges(
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
      }))
    );

    // Trigger auto-save
    window.dispatchEvent(new Event("model:updated"));

    toast({
      title: "Model updated",
      description: "Milton generated a new data model based on your files.",
    });
  };

  // Ask Milton to propose a data model
  const handleAskMiltonProposeModel = async () => {
    if (!businessType) {
      toast({
        title: "Business type required",
        description: "Please select a business type first.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsAiProposing(true);

      // 1. Fetch custom datasets (for sample rows)
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Authentication required",
          description: "Please log in to use this feature.",
          variant: "destructive",
        });
        return;
      }

      const datasetRows = await listCustomDatasets(user.id);

      // Adapt to analyzer input format
      const analyzerDatasets = (datasetRows ?? [])
        .filter((ds) => Array.isArray(ds.rows_json) && ds.rows_json.length > 0)
        .map((ds) => ({
          sourceName: ds.dataset_name ?? "Dataset",
          tableHint: (ds.source_meta as any)?.sheetName ?? null,
          sampleRows: ds.rows_json as Record<string, unknown>[],
        }));

      // Show confirmation if no datasets found
      if (analyzerDatasets.length === 0) {
        const proceed = window.confirm?.(
          "No uploaded datasets with samples found. Milton will propose a generic model for your business type. Continue?"
        );
        if (!proceed) {
          setIsAiProposing(false);
          return;
        }
      }

      // 2. Build input for analyzer
      const input = {
        businessType,
        datasets: analyzerDatasets,
        currentModel: model, // Pass current model for refinement
      };

      console.log(
        "[DataModelBuilder] Calling AI Business Model Analyzer with",
        {
          businessType,
          datasetsCount: analyzerDatasets.length,
          hasCurrentModel: !!model,
        }
      );

      // 3. Call the AI analyzer
      const proposal = await callBusinessModelAnalyzer(input);

      if (!proposal) {
        toast({
          title: "AI generation failed",
          description: "Milton could not generate a model. Please try again.",
          variant: "destructive",
        });
        return;
      }

      // 4. Ask user to confirm replacement
      const shouldApply =
        window.confirm?.(
          "Milton has generated a proposed data model based on your files. Replace your current model with this proposal?"
        ) ?? true;

      if (!shouldApply) {
        toast({
          title: "Cancelled",
          description: "Model proposal was not applied.",
        });
        return;
      }

      // 5. Apply the proposal
      applyModelProposal(proposal);

      // Publish event for Milton chat
      miltonEventsAPI.publish("chat", {
        role: "milton",
        content: `✅ I've generated a ${businessType.replace("_", " ")} data model with ${proposal.recommendedTables?.length ?? 0} tables. You can now upload your data files or adjust the schema.`,
      });
    } catch (err) {
      console.error(
        "[DataModelBuilder] Error calling business-model-analyzer",
        err
      );
      toast({
        title: "Error",
        description:
          (err as Error)?.message || "Failed to generate model proposal.",
        variant: "destructive",
      });
    } finally {
      setIsAiProposing(false);
    }
  };

  // Auto-save on model changes (debounced)
  useEffect(() => {
    if (!model) return;
    const timer = setTimeout(async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          // Get company for user
          const { data: company } = await supabase
            .from("companies")
            .select("id")
            .eq("created_by", user.id)
            .single();

          if (company) {
            // Save to canonical_model in business_models table (preferred)
            const { error } = await supabase
              .from("business_models")
              .update({
                canonical_model: model,
                model_json: model, // Keep for backwards compatibility (deprecated)
              })
              .eq("company_id", company.id);

            if (error) {
              console.error("Auto-save failed:", error);
            }
          }
        }
        localStorage.setItem("milton-model", JSON.stringify(model));
        // Silent auto-save: no toasts or banners
      } catch (e) {
        console.error("Auto-save failed", e);
      }
    }, 1500); // 1.5s debounce
    return () => clearTimeout(timer);
  }, [model]);

  if (
    !model ||
    !model.recommendedTables ||
    model.recommendedTables.length === 0
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
        <p>No tables detected yet.</p>
        <p className="mt-2">
          Upload your data files to start building your dashboards.
        </p>
      </div>
    );
  }

  if (!ReactFlow) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        <div className="text-center">
          <p className="mb-2">ReactFlow is not installed.</p>
          <p className="text-xs">
            Run:{" "}
            <code className="bg-gray-100 px-2 py-1 rounded">
              npm install reactflow
            </code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[85vh] w-full flex flex-col bg-white rounded-md shadow-sm">
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      {/* Header with business model select + buttons */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <div>
          <h2 className="text-lg font-semibold mb-1">Your Data Model</h2>
          {dbBusinessType && (
            <p className="text-sm text-gray-600">
              Business Type:{" "}
              <span className="font-medium">
                {businessModelTemplates.find((t) => t.id === dbBusinessType)
                  ?.label || dbBusinessType}
              </span>
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                disabled={true}
                className="px-3 py-1 text-white rounded text-sm bg-indigo-300 cursor-not-allowed"
              >
                Ask Milton to propose a model
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                🚀 Coming soon! We're building something amazing for you - stay
                tuned!
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main visual data model canvas */}
      <div className="flex-1 relative overflow-visible">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          // Disable all interactions for read-only mode
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y={true}
          className="h-full"
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
      {/* Table field sidebar */}
      {selectedTable && (
        <div className="absolute right-0 top-0 h-full w-80 bg-white border-l border-gray-200 shadow-lg p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-700 text-sm">
              {selectedTable} Fields
            </h3>
            <button
              className="text-xs text-gray-500 hover:text-gray-800"
              onClick={() => setSelectedTable(null)}
            >
              ✕
            </button>
          </div>
          {(() => {
            const table = model?.recommendedTables.find(
              (t) => t.name === selectedTable
            );
            if (!table)
              return <p className="text-xs text-gray-400">No table found.</p>;
            const handleRename = (index: number, newName: string) => {
              const oldName = table!.fields[index].name;
              setModel(renameField(model!, selectedTable!, oldName, newName));
            };
            const handleTypeChange = (index: number, newType: string) => {
              const t = { ...model! };
              const tblIndex = t.recommendedTables.findIndex(
                (tt) => tt.name === selectedTable
              );
              if (tblIndex === -1) return;
              const tbl = { ...t.recommendedTables[tblIndex] };
              const fields = [...tbl.fields];
              fields[index] = { ...fields[index], type: newType };
              tbl.fields = fields;
              const recommendedTables = [...t.recommendedTables];
              recommendedTables[tblIndex] = tbl;
              setModel({ ...t, recommendedTables });
            };
            const handleDelete = (index: number) => {
              const fieldName = table!.fields[index].name;
              setModel(removeField(model!, selectedTable!, fieldName));
            };
            const handleAddField = () => {
              const newField = {
                name: `new_field_${table!.fields.length + 1}`,
                type: "string",
              };
              setModel(addField(model!, selectedTable!, newField));
            };
            return (
              <div>
                <ColumnEditor
                  columns={table!.fields.map((f) => ({
                    name: f.name,
                    type: f.type || "string",
                  }))}
                  onRename={handleRename}
                  onTypeChange={handleTypeChange}
                  onDelete={handleDelete}
                />
                <button
                  onClick={handleAddField}
                  className="mt-3 w-full py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  + Add Field
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
