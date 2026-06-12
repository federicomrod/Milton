// components/restaurant/SuppliersPage.tsx
//
// Supplier management UI. Shows a supplier list with aggregated metrics
// (linked ingredient count, latest purchase date, total spend) and a
// create/edit form.
//
// Data flow: the page (Server Component) fetches via
// /api/restaurant/suppliers which returns the enriched list. All mutations
// are client-side fetch calls followed by router.refresh().

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, Plus, Pencil, X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupplierRow {
  id: string;
  name: string;
  status: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  address: string | null;
  payment_terms: string | null;
  tax_id: string | null;
  ingredient_count: number;
  latest_cost_date: string | null;
  total_spend: number | null;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export function SuppliersPage({ suppliers }: { suppliers: SupplierRow[] }) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="space-y-8 max-w-screen-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-orange-500" />
            <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
            <Badge className="text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-0">
              {suppliers.length}
            </Badge>
          </div>
          <Button
            size="sm"
            className="gap-2"
            onClick={() => setShowCreate((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            {showCreate ? "Cancel" : "Add supplier"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground -mt-4 max-w-3xl">
          Suppliers are created automatically during bulk cost uploads. Use this
          page to add contact details, review linked ingredients, and manage
          supplier status.
        </p>

        {/* Create form */}
        {showCreate && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plus className="h-4 w-4" /> New supplier
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SupplierForm
                onSuccess={() => setShowCreate(false)}
                onCancel={() => setShowCreate(false)}
              />
            </CardContent>
          </Card>
        )}

        {/* Suppliers list */}
        {suppliers.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <p className="text-sm text-muted-foreground">
                No suppliers yet. They are created automatically when you import
                a cost file, or you can add one manually above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {suppliers.map((s) => (
              <SupplierCard key={s.id} supplier={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supplier card (collapsible edit)
// ---------------------------------------------------------------------------

function SupplierCard({ supplier }: { supplier: SupplierRow }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const [archiving, startArchiveTx] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const onArchive = () => {
    if (
      !confirm(
        `Archive "${supplier.name}"?\n\nThe supplier will be hidden from new cost entries but existing cost history is preserved.`
      )
    )
      return;
    setArchiveError(null);
    startArchiveTx(async () => {
      try {
        const res = await fetch(`/api/restaurant/suppliers/${supplier.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setArchiveError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        router.refresh();
      } catch (err) {
        setArchiveError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  const statusColor =
    supplier.status === "active"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
      : supplier.status === "archived"
        ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";

  return (
    <Card>
      <CardContent className="py-4">
        {editing ? (
          <SupplierForm
            supplier={supplier}
            onSuccess={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Name + status */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{supplier.name}</span>
                <span
                  className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${statusColor}`}
                >
                  {supplier.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {supplier.contact_name && <span>{supplier.contact_name}</span>}
                {supplier.email && <span>{supplier.email}</span>}
                {supplier.phone && <span>{supplier.phone}</span>}
              </div>
              {supplier.notes && (
                <p className="text-xs text-muted-foreground italic mt-1">
                  {supplier.notes}
                </p>
              )}
            </div>

            {/* Metrics */}
            <div className="flex gap-6 text-center text-xs shrink-0">
              <div>
                <div className="font-semibold text-base">
                  {supplier.ingredient_count}
                </div>
                <div className="text-muted-foreground">ingredients</div>
              </div>
              {supplier.latest_cost_date && (
                <div>
                  <div className="font-semibold text-base">
                    {supplier.latest_cost_date}
                  </div>
                  <div className="text-muted-foreground">last purchase</div>
                </div>
              )}
              {supplier.total_spend !== null && (
                <div>
                  <div className="font-semibold text-base">
                    {supplier.total_spend.toLocaleString("es-MX", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </div>
                  <div className="text-muted-foreground">total spend</div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-xs"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              {supplier.status !== "archived" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground hover:text-red-700"
                  onClick={onArchive}
                  disabled={archiving}
                >
                  Archive
                </Button>
              )}
            </div>
            {archiveError && (
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                {archiveError}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit form (shared)
// ---------------------------------------------------------------------------

interface SupplierFormProps {
  supplier?: SupplierRow;
  onSuccess: () => void;
  onCancel: () => void;
}

function SupplierForm({ supplier, onSuccess, onCancel }: SupplierFormProps) {
  const router = useRouter();
  const isEdit = !!supplier;

  const [name, setName] = useState(supplier?.name ?? "");
  const [contactName, setContactName] = useState(supplier?.contact_name ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [status, setStatus] = useState(supplier?.status ?? "active");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [paymentTerms, setPaymentTerms] = useState(
    supplier?.payment_terms ?? ""
  );
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    startTx(async () => {
      try {
        const url = isEdit
          ? `/api/restaurant/suppliers/${supplier!.id}`
          : "/api/restaurant/suppliers";
        const res = await fetch(url, {
          method: isEdit ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            contact_name: contactName.trim() || null,
            email: email.trim() || null,
            phone: phone.trim() || null,
            status,
            notes: notes.trim() || null,
            address: address.trim() || null,
            payment_terms: paymentTerms.trim() || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body?.error === "string" ? body.error : `HTTP ${res.status}`
          );
          return;
        }
        router.refresh();
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-muted-foreground">Name *</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fresh Fields Co."
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Contact name</span>
          <Input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Ana López"
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Email</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@supplier.com"
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Phone</span>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+52 55 1234 5678"
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Payment terms</span>
          <Input
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            placeholder="Net 30"
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-muted-foreground">Address</span>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Calle Reforma 100, CDMX"
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-3">
          <span className="text-xs text-muted-foreground">Notes</span>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
            className="h-9"
          />
        </label>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="gap-1"
        >
          <Check className="h-4 w-4" />
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add supplier"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
          className="gap-1"
        >
          <X className="h-4 w-4" />
          Cancel
        </Button>
        {error && (
          <span className="text-xs text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
