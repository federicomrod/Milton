// components/restaurant/SuppliersPage.tsx
//
// Supplier management UI. Shows a supplier list with aggregated metrics
// (linked ingredient count, latest purchase date, total spend) and a
// create/edit form.
//
// Data flow: Costos › Proveedores (loadSuppliersTabData) passes the
// enriched list. All mutations
// are client-side fetch calls; the list updates from each API answer.

"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, X, Check } from "lucide-react";
import { CAPABILITY_MESSAGES } from "@/lib/auth/capabilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtMoney } from "@/components/restaurant/InvoicesPage";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { useT } from "@/lib/i18n/client";

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
  /** Company currency for «gasto total»; missing = USD. */
  currency?: string;
}

/** «2026-03-05» → «05/03/2026» («05.03.2026» in German; string split: no timezone shift). */
export function formatSupplierDate(
  iso: string,
  lang: "en" | "es" | "de" = "es"
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const sep = lang === "de" ? "." : "/";
  return m ? `${m[3]}${sep}${m[2]}${sep}${m[1]}` : iso;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export function SuppliersPage({
  suppliers: initial,
  canEditPrices = true,
}: {
  suppliers: SupplierRow[];
  /** The server's can("prices.edit") answer; false = read-only. */
  canEditPrices?: boolean;
}) {
  const { d, locale, fmt } = useT();
  const sp = d.costs.suppliers;
  const [showCreate, setShowCreate] = useState(false);
  // R1-09c: saves update this list from the API's answer; no refresh of
  // the whole server page.
  const [suppliers, setSuppliers] = useState(initial);
  const upsert = (row: SupplierRow) =>
    setSuppliers((prev) =>
      prev.some((s) => s.id === row.id)
        ? prev.map((s) => (s.id === row.id ? { ...s, ...row } : s))
        : [...prev, row].sort((a, b) => a.name.localeCompare(b.name, locale))
    );

  // Rendered inside Costos › Proveedores (R1-09b): no page header here.
  return (
    <div className="w-full">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-[#6b7385]">
            {suppliers.length === 1
              ? sp.countOne
              : fmt(sp.countOther, { n: suppliers.length })}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={!canEditPrices}
            onClick={() => setShowCreate((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            {showCreate ? sp.cancel : sp.add}
          </Button>
        </div>

        {canEditPrices ? null : (
          <p data-testid="prices-readonly" className="text-xs text-[#6b7280]">
            {CAPABILITY_MESSAGES["prices.edit"]}
          </p>
        )}

        {/* Create form */}
        {showCreate && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plus className="h-4 w-4" /> {sp.newTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SupplierForm
                onSuccess={(row) => {
                  setShowCreate(false);
                  if (row) upsert(row);
                }}
                onCancel={() => setShowCreate(false)}
              />
            </CardContent>
          </Card>
        )}

        {/* Suppliers list */}
        {suppliers.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <p className="text-sm text-muted-foreground">{sp.empty}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {suppliers.map((s) => (
              <SupplierCard
                key={s.id}
                supplier={s}
                canEdit={canEditPrices}
                onSaved={upsert}
                onArchived={(id) =>
                  setSuppliers((prev) =>
                    prev.map((row) =>
                      row.id === id ? { ...row, status: "archived" } : row
                    )
                  )
                }
              />
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

function SupplierCard({
  supplier,
  canEdit,
  onSaved,
  onArchived,
}: {
  supplier: SupplierRow;
  canEdit: boolean;
  onSaved: (row: SupplierRow) => void;
  onArchived: (id: string) => void;
}) {
  const { d, lang, fmt } = useT();
  const sp = d.costs.suppliers;
  const statusLabel: Record<string, string> = {
    active: sp.statusActive,
    inactive: sp.statusInactive,
    archived: sp.statusArchived,
  };
  const [editing, setEditing] = useState(false);
  const [archiving, startArchiveTx] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const onArchive = () => {
    if (!confirm(fmt(sp.archiveConfirm, { name: supplier.name }))) return;
    setArchiveError(null);
    startArchiveTx(async () => {
      try {
        const res = await fetch(`/api/restaurant/suppliers/${supplier.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setArchiveError(userErrorMessage(body, sp.archiveFailed));
          return;
        }
        onArchived(supplier.id);
      } catch (err) {
        setArchiveError(err instanceof Error ? err.message : sp.networkError);
      }
    });
  };

  const statusColor =
    supplier.status === "active"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
      : supplier.status === "archived"
        ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        : "bg-gray-100 text-gray-700 dark:bg-gray-800/30 dark:text-gray-400";

  return (
    <Card>
      <CardContent className="py-4">
        {editing ? (
          <SupplierForm
            supplier={supplier}
            onSuccess={(row) => {
              setEditing(false);
              if (row) onSaved(row);
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
                  className={`text-xs rounded px-1.5 py-0.5 font-medium ${statusColor}`}
                >
                  {statusLabel[supplier.status] ?? supplier.status}
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
                <div className="text-muted-foreground">{sp.ingredients}</div>
              </div>
              {supplier.latest_cost_date && (
                <div>
                  <div className="font-semibold text-base">
                    {formatSupplierDate(supplier.latest_cost_date, lang)}
                  </div>
                  <div className="text-muted-foreground">{sp.lastPurchase}</div>
                </div>
              )}
              {supplier.total_spend !== null && (
                <div>
                  <div className="font-semibold text-base">
                    {fmtMoney(
                      supplier.total_spend,
                      supplier.currency ?? "USD",
                      lang
                    )}
                  </div>
                  <div className="text-muted-foreground">{sp.totalSpend}</div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-xs"
                disabled={!canEdit}
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                {sp.edit}
              </Button>
              {supplier.status !== "archived" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs border-[#d5dae3] text-[#151c2c] hover:bg-[#E7EDFD]"
                  onClick={onArchive}
                  disabled={archiving || !canEdit}
                >
                  {sp.archive}
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
  /** The saved supplier as the API returned it. */
  onSuccess: (row: SupplierRow | null) => void;
  onCancel: () => void;
}

function SupplierForm({ supplier, onSuccess, onCancel }: SupplierFormProps) {
  const { d } = useT();
  const sp = d.costs.suppliers;
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
      setError(sp.nameRequired);
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
          setError(userErrorMessage(body, sp.saveFailed));
          return;
        }
        onSuccess(
          body && typeof body === "object" && "supplier" in body
            ? (body.supplier as SupplierRow)
            : null
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : sp.networkError);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-muted-foreground">{sp.fieldName}</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={sp.namePlaceholder}
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {sp.fieldStatus}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="active">{sp.statusActive}</option>
            {status === "inactive" && (
              <option value="inactive">{sp.statusInactive}</option>
            )}
            <option value="archived">{sp.statusArchived}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {sp.fieldContact}
          </span>
          <Input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder={sp.contactPlaceholder}
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{sp.fieldEmail}</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={sp.emailPlaceholder}
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{sp.fieldPhone}</span>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={sp.phonePlaceholder}
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {sp.fieldPaymentTerms}
          </span>
          <Input
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            placeholder={sp.paymentTermsPlaceholder}
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-muted-foreground">
            {sp.fieldAddress}
          </span>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={sp.addressPlaceholder}
            className="h-9"
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-3">
          <span className="text-xs text-muted-foreground">{sp.fieldNotes}</span>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={sp.notesPlaceholder}
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
          {pending ? sp.saving : isEdit ? sp.saveChanges : sp.add}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
          className="gap-1"
        >
          <X className="h-4 w-4" />
          {sp.cancel}
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
