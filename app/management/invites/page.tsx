"use client";

// app/management/invites/page.tsx
//
// Thin Milton-admin UI for workspace invites (R1 item 2). Behind the
// /management layout admin gate; every action calls the admin-only
// /api/management/invites* routes. Shows a copyable link once after
// creation, invite statuses with a revoke button, and recent "Connect your
// data" requests for the selected company (read-only).

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Company {
  id: string;
  name: string;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
  created_at: string;
}
interface DataRequest {
  id: string;
  company_id: string;
  source: string;
  details: string | null;
  created_at: string;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";

export default function InvitesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    link: string;
    emailNote: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (id: string) => {
    setError(null);
    const res = await fetch(
      `/api/management/invites${id ? `?company_id=${id}` : ""}`
    );
    if (!res.ok) {
      setError("Could not load invites.");
      return;
    }
    const data = await res.json();
    setCompanies(data.companies ?? []);
    setInvites(data.invites ?? []);
    setRequests(data.recent_requests ?? []);
  }, []);

  useEffect(() => {
    void load(companyId);
  }, [companyId, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/management/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          email,
          ...(role ? { role } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create invite.");
      } else {
        setResult({ link: data.link, emailNote: data.email_note });
        setEmail("");
        await load(companyId);
      }
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/management/invites/${id}/revoke`, {
      method: "POST",
    });
    if (!res.ok) setError("Could not revoke invite.");
    await load(companyId);
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Workspace invites</h1>
        <p className="text-sm text-muted-foreground">
          Invite a client into an existing workspace. The link works once and
          expires in 7 days.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New invite</CardTitle>
          <CardDescription>
            Role defaults to owner for a workspace with no owner yet, otherwise
            member.
          </CardDescription>
        </CardHeader>
        <form onSubmit={create}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="company">Workspace</Label>
              <select
                id="company"
                className={selectClass}
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                required
              >
                <option value="">Select a company…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role (optional)</Label>
              <select
                id="role"
                className={selectClass}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">Default</option>
                <option value="owner">Owner</option>
                <option value="member">Member</option>
              </select>
            </div>
            <Button type="submit" disabled={busy || !companyId}>
              {busy ? "Creating…" : "Create invite"}
            </Button>
            {result && (
              <Alert>
                <AlertDescription className="space-y-2">
                  <div>{result.emailNote}</div>
                  <div className="flex gap-2">
                    <Input readOnly value={result.link} />
                    <Button type="button" variant="outline" onClick={copy}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    This link is shown only once.
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invites</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {invites.length === 0 && (
            <p className="text-sm text-muted-foreground">No invites yet.</p>
          )}
          {invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-2 border-b py-2 text-sm"
            >
              <div>
                <div className="font-medium">{i.email}</div>
                <div className="text-xs text-muted-foreground">
                  {i.role} · expires{" "}
                  {new Date(i.expires_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={i.status === "pending" ? "default" : "secondary"}
                >
                  {i.status}
                </Badge>
                {i.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => revoke(i.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent data-source requests</CardTitle>
          <CardDescription>
            Submitted from the Connect your data screen
            {companyId ? " for this workspace" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {requests.length === 0 && (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          )}
          {requests.map((r) => (
            <div key={r.id} className="border-b py-2 text-sm">
              <span className="font-medium">{r.source}</span>
              <span className="text-xs text-muted-foreground">
                {" "}
                · {new Date(r.created_at).toLocaleString()}
                {!companyId &&
                  ` · ${companies.find((c) => c.id === r.company_id)?.name ?? ""}`}
              </span>
              {r.details && (
                <div className="text-muted-foreground">{r.details}</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
