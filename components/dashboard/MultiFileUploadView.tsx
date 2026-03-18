"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  FileText,
  Brain,
  AlertTriangle,
  X,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  ModelProposal,
  TableDef,
  getTableDisplayName,
} from "@/lib/model/transform";
import { ColumnMapping } from "@/types/schema";
import EnhancedDataMappingUI from "./data-mapping-confirmation";
import { normalizeDateValue } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedEntry {
  id: string;
  file: File;
  sheetName?: string;
  /** Human-readable label shown in the review table */
  displayName: string;
  headers: string[];
  sampleData: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  totalRows: number;
  /** Table name as returned by the AI classifier (normalised to model table name) */
  proposedTable: string | null;
  confidence: number;
  /** Editable by the user in the review step */
  confirmedTable: string;
  /** @deprecated entries are now removed directly; this field is unused */
  skip?: boolean;
}

interface MappingResult {
  entry: ParsedEntry;
  mappings: ColumnMapping[];
  valueMappings?: Record<string, Record<string, string>>;
}

type Step =
  | "select"
  | "classifying"
  | "review"
  | "mapping"
  | "uploading"
  | "done";

interface MultiFileUploadViewProps {
  model: ModelProposal;
  allTableDataCounts: Record<string, number>;
  onComplete: () => void;
  onCancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Fuzzy-match an AI-detected table name against the model's table names.
 * Returns the matched model table name or null.
 */
function matchTableName(
  detected: string,
  modelTables: TableDef[]
): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(detected);
  const exact = modelTables.find((t) => norm(t.name) === n);
  if (exact) return exact.name;
  const contains = modelTables.find(
    (t) => n.includes(norm(t.name)) || norm(t.name).includes(n)
  );
  return contains ? contains.name : null;
}

/**
 * Generate column ↔ field mappings based purely on header names vs field names.
 */
function generateAutoMappings(
  headers: string[],
  fields: TableDef["fields"]
): ColumnMapping[] {
  return headers.map((header) => {
    const nh = header.toLowerCase().trim();
    const match = fields.find((f) => {
      const nf = f.name.toLowerCase().trim();
      return nh === nf || nh.includes(nf) || nf.includes(nh);
    });
    return {
      originalColumn: header,
      standardField: match ? match.name : "unmapped",
      confidence: match ? 0.9 : 0,
      dataType: "string" as const,
      transformation: "none" as const,
    };
  });
}

/** Determine which referenced tables are empty (for dependency warnings). */
function getMissingDeps(
  table: TableDef,
  allCounts: Record<string, number>
): string[] {
  const norm = (n: string) => n.toLowerCase().replace(/[\s_-]+/g, "_");
  const countsByNorm = new Map<string, number>();
  for (const [name, count] of Object.entries(allCounts)) {
    countsByNorm.set(norm(name), count);
  }
  return table.fields
    .filter((f) => f.references?.table)
    .map((f) => f.references!.table)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .filter((t) => {
      const c = countsByNorm.get(norm(t));
      return c === undefined || c === 0;
    });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MultiFileUploadView({
  model,
  allTableDataCounts,
  onComplete,
  onCancel,
}: MultiFileUploadViewProps) {
  const [step, setStep] = useState<Step>("select");
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [currentMappingIdx, setCurrentMappingIdx] = useState(0);
  const [completedMappings, setCompletedMappings] = useState<MappingResult[]>(
    []
  );
  /** Draft column mappings per entry id, so switching files preserves in-progress mapping */
  const [draftMappingsByEntry, setDraftMappingsByEntry] = useState<
    Record<string, ColumnMapping[]>
  >({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const modelTables = model.recommendedTables ?? [];
  const businessContext = `Tables in this data model: ${modelTables.map((t) => t.name).join(", ")}`;

  // ── File ingestion ──────────────────────────────────────────────────────────

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setStep("classifying");
      setUploadError(null);

      const pending: ParsedEntry[] = [];

      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/data/parse", {
            method: "POST",
            body: fd,
          });
          if (!res.ok) throw new Error(`Parse failed for ${file.name}`);
          const parsed = await res.json();

          if (parsed.sheets && parsed.sheets.length > 0) {
            // Multi-sheet Excel: create one entry per sheet
            for (const sheet of parsed.sheets as {
              name: string;
              headers: string[];
              sampleData: unknown[];
              rows: unknown[];
              totalRows: number;
            }[]) {
              pending.push({
                id: uid(),
                file,
                sheetName: sheet.name,
                displayName: `${file.name} › ${sheet.name}`,
                headers: sheet.headers,
                sampleData: (sheet.sampleData ?? []) as Record<
                  string,
                  unknown
                >[],
                rows: (sheet.rows ?? sheet.sampleData ?? []) as Record<
                  string,
                  unknown
                >[],
                totalRows: sheet.totalRows,
                proposedTable: null,
                confidence: 0,
                confirmedTable: modelTables[0]?.name ?? "",
              });
            }
          } else {
            // Single sheet / CSV
            pending.push({
              id: uid(),
              file,
              displayName: file.name,
              headers: parsed.headers ?? [],
              sampleData: (parsed.sampleData ?? []) as Record<
                string,
                unknown
              >[],
              rows: (parsed.rows ?? parsed.sampleData ?? []) as Record<
                string,
                unknown
              >[],
              totalRows: parsed.totalRows ?? 0,
              proposedTable: null,
              confidence: 0,
              confirmedTable: modelTables[0]?.name ?? "",
            });
          }
        } catch (err) {
          console.error("[MultiFileUpload] parse error:", err);
          // Skip failed files but continue
        }
      }

      // AI classify every entry in parallel
      const classified = await Promise.all(
        pending.map(async (entry) => {
          try {
            const res = await fetch("/api/ai/dataset-classifier", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                datasetName: entry.sheetName ?? entry.file.name,
                columns: entry.headers,
                sampleRows: entry.sampleData.slice(0, 3),
                businessContext,
              }),
            });
            if (!res.ok) return entry;
            const data = await res.json();
            const matched = data.detectedTable
              ? matchTableName(data.detectedTable, modelTables)
              : null;
            return {
              ...entry,
              proposedTable: matched,
              confidence: data.confidence ?? 0,
              confirmedTable: matched ?? entry.confirmedTable,
            } as ParsedEntry;
          } catch {
            return entry;
          }
        })
      );

      setEntries(classified);
      setStep("review");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [businessContext, modelTables]
  );

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        /\.(xlsx|xls|csv)$/i.test(f.name)
      );
      processFiles(files);
    },
    [processFiles]
  );

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      processFiles(files);
      e.target.value = "";
    },
    [processFiles]
  );

  // ── Review helpers ──────────────────────────────────────────────────────────

  // All remaining entries are active (removal is the only way to exclude them now)
  const activeEntries = entries;

  const updateEntry = (id: string, patch: Partial<ParsedEntry>) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  };

  // ── Mapping sequence ─────────────────────────────────────────────────────────

  const startMapping = () => {
    setCompletedMappings([]);
    setDraftMappingsByEntry({});
    setCurrentMappingIdx(0);
    setStep("mapping");
  };

  const handleMappingConfirm = async (
    mappings: ColumnMapping[],
    valueMappings?: Record<string, Record<string, string>>
  ) => {
    const entry = activeEntries[currentMappingIdx];
    const result: MappingResult = { entry, mappings, valueMappings };
    const next = [...completedMappings, result];
    setCompletedMappings(next);
    setDraftMappingsByEntry((prev) => {
      const { [entry.id]: _, ...rest } = prev;
      return rest;
    });

    if (currentMappingIdx + 1 < activeEntries.length) {
      setCurrentMappingIdx(currentMappingIdx + 1);
    } else {
      // All mapped — upload
      await uploadAll(next);
    }
  };

  const handleMappingCancel = () => {
    // Go back to review
    setStep("review");
  };

  // ── Upload ───────────────────────────────────────────────────────────────────

  const uploadAll = async (results: MappingResult[]) => {
    setStep("uploading");
    setUploadError(null);

    for (const result of results) {
      const { entry, mappings, valueMappings } = result;
      const table = modelTables.find((t) => t.name === entry.confirmedTable);

      const transformedRows = entry.rows.map((row) => {
        const out: Record<string, unknown> = {};
        mappings.forEach((m) => {
          if (m.standardField !== "unmapped") {
            const val = row[m.originalColumn];
            if (val !== undefined && val !== null) {
              const fieldDef = table?.fields.find(
                (f) => f.name === m.standardField
              );
              if (
                fieldDef &&
                (fieldDef.type === "date" || fieldDef.type === "datetime")
              ) {
                out[m.standardField] = normalizeDateValue(val) ?? val;
              } else {
                out[m.standardField] = val;
              }
            }
          }
        });
        if (valueMappings) {
          for (const [fieldName, fm] of Object.entries(valueMappings)) {
            if (out[fieldName] !== undefined) {
              const mapped = fm[String(out[fieldName])];
              if (mapped !== undefined) out[fieldName] = mapped;
            }
          }
        }
        return out;
      });

      try {
        const res = await fetch("/api/data/upload-model-table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableName: entry.confirmedTable,
            rows: transformedRows,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            err.error ?? `Upload failed for ${entry.displayName}`
          );
        }
      } catch (err) {
        setUploadError((err as Error).message);
        setStep("review");
        return;
      }
    }

    setStep("done");
    onComplete();
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (step === "classifying") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Parsing files and classifying datasets…
        </p>
      </div>
    );
  }

  if (step === "uploading") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Uploading data…</p>
      </div>
    );
  }

  if (step === "mapping") {
    const entry = activeEntries[currentMappingIdx];
    if (!entry) return null;
    const table = modelTables.find((t) => t.name === entry.confirmedTable);
    const fields = table?.fields ?? [];
    const autoMappings = generateAutoMappings(entry.headers, fields);
    const completedForEntry = completedMappings.find(
      (r) => r.entry.id === entry.id
    );
    const suggestedMappings =
      draftMappingsByEntry[entry.id] ??
      completedForEntry?.mappings ??
      autoMappings;
    const missingDeps = table ? getMissingDeps(table, allTableDataCounts) : [];
    const completedIds = new Set(completedMappings.map((r) => r.entry.id));

    return (
      <div className="flex gap-4 h-[calc(100vh-8rem)] min-h-0">
        {/* Left: file / table mapping selector (when multiple files) */}
        {activeEntries.length > 1 && (
          <div className="flex-shrink-0 w-56 flex flex-col gap-2 border-r pr-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleMappingCancel}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Review
              </Button>
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              File / Table mapping
            </p>
            <nav className="flex flex-col gap-1 overflow-y-auto min-h-0">
              {activeEntries.map((e, idx) => {
                const isCurrent = idx === currentMappingIdx;
                const isDone = completedIds.has(e.id);
                const tableDef = modelTables.find(
                  (t) => t.name === e.confirmedTable
                ) ?? {
                  name: e.confirmedTable,
                  fields: [],
                };
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setCurrentMappingIdx(idx)}
                    className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left w-full transition-colors ${
                      isCurrent
                        ? "border-primary bg-primary/10 ring-1 ring-primary/20"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span
                      className={`text-sm font-medium truncate w-full ${isCurrent ? "text-primary" : "text-foreground"}`}
                    >
                      {e.displayName}
                    </span>
                    <span className="text-xs text-muted-foreground truncate w-full">
                      → {getTableDisplayName(tableDef)}
                    </span>
                    {isDone && (
                      <Badge className="mt-1 text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                        Mapped
                      </Badge>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* Right: current file mapping (or only content when single file) */}
        <div className="flex-1 min-w-0 flex flex-col">
          {activeEntries.length === 1 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-shrink-0 mb-2">
              <Button variant="ghost" size="sm" onClick={handleMappingCancel}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Review
              </Button>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <EnhancedDataMappingUI
              key={entry.id}
              fileName={entry.displayName}
              fileType="transactions"
              headers={entry.headers}
              sampleData={entry.sampleData}
              allRows={entry.rows}
              suggestedMappings={suggestedMappings}
              confidence={0.8}
              issues={[]}
              onConfirm={handleMappingConfirm}
              onCancel={handleMappingCancel}
              onDraftChange={
                activeEntries.length > 1
                  ? (mappings) =>
                      setDraftMappingsByEntry((prev) => ({
                        ...prev,
                        [entry.id]: mappings,
                      }))
                  : undefined
              }
              modelTableFields={fields.map((f) => ({
                name: f.name,
                required: f.required,
                type: f.type,
                primaryKey: f.primaryKey,
                references: f.references,
                allowedValues: f.allowedValues,
              }))}
              modelTableName={entry.confirmedTable}
              missingDependencies={missingDeps}
              embedInLayout={activeEntries.length > 1}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Select / Review steps ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Tables
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Upload Multiple Files</h2>
          <p className="text-sm text-muted-foreground">
            Upload one or more CSV / Excel files. The system will propose which
            table each file or sheet belongs to. Review and confirm before
            column mapping.
          </p>
        </div>
      </div>

      {uploadError && (
        <Alert className="border-red-300 bg-red-50 dark:bg-red-950/30">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-700 dark:text-red-300">
            {uploadError}
          </AlertDescription>
        </Alert>
      )}

      {/* Drop zone (always visible in select/review so user can add more files) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">
          {step === "review"
            ? "Drop more files here to add them"
            : "Drop files here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          .xlsx, .xls, .csv — multi-sheet Excel supported
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          className="hidden"
          onChange={onFileInputChange}
        />
      </div>

      {/* Classification review table */}
      {step === "review" && entries.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Document Classification Review
            </h3>
            <span className="text-xs text-muted-foreground">
              {entries.length} file{entries.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left font-medium w-8">#</th>
                  <th className="p-3 text-left font-medium">File / Sheet</th>
                  <th className="p-3 text-left font-medium w-24">Rows</th>
                  <th className="p-3 text-left font-medium">
                    <span className="flex items-center gap-1">
                      <Brain className="h-3.5 w-3.5 text-purple-500" />
                      Proposed Table
                    </span>
                  </th>
                  <th className="p-3 text-left font-medium w-24">Confidence</th>
                  <th className="p-3 text-left font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    className="border-t transition-colors hover:bg-muted/20"
                  >
                    <td className="p-3 text-muted-foreground">{idx + 1}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium truncate max-w-xs">
                          {entry.displayName}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {entry.totalRows.toLocaleString()}
                    </td>
                    <td className="p-3">
                      <Select
                        value={entry.confirmedTable}
                        onValueChange={(v) =>
                          updateEntry(entry.id, { confirmedTable: v })
                        }
                      >
                        <SelectTrigger className="w-52 h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {modelTables.map((t) => (
                            <SelectItem key={t.name} value={t.name}>
                              {getTableDisplayName(t)}
                              {entry.proposedTable === t.name && (
                                <Sparkles className="h-3 w-3 ml-1 inline text-purple-500" />
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {entry.proposedTable &&
                        entry.proposedTable !== entry.confirmedTable && (
                          <p className="text-xs text-muted-foreground mt-1">
                            AI suggested:{" "}
                            <span className="font-medium">
                              {getTableDisplayName(
                                modelTables.find(
                                  (t) => t.name === entry.proposedTable
                                ) ?? { name: entry.proposedTable, fields: [] }
                              )}
                            </span>
                          </p>
                        )}
                    </td>
                    <td className="p-3">
                      {entry.confidence > 0 ? (
                        <Badge
                          className={
                            entry.confidence >= 0.8
                              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                              : entry.confidence >= 0.5
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                                : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                          }
                        >
                          {Math.round(entry.confidence * 100)}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setEntries((prev) =>
                            prev.filter((e) => e.id !== entry.id)
                          )
                        }
                        title="Remove this file"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Action footer */}
          <div className="flex justify-between items-center pt-2">
            <p className="text-xs text-muted-foreground">
              {activeEntries.length} file
              {activeEntries.length !== 1 ? "s" : ""} will be mapped and
              uploaded. Multiple files may map to the same table — rows are
              always appended.
            </p>
            <Button
              onClick={startMapping}
              disabled={activeEntries.length === 0}
            >
              Proceed to Column Mapping
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
