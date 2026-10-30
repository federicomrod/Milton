"use client";

// components/auth/invite-accept-form.tsx
//
// Client form for /auth/invite (R1 item 2). Two modes: set a password
// (new invitee) or one-click "Join workspace" when the signed-in user's
// email matches the invited email. Never logs or echoes the password.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/auth/password-input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useT } from "@/lib/i18n/client";

const MIN_PASSWORD = 8;

export function InviteAcceptForm({
  token,
  email,
  signedInEmail,
}: {
  token: string;
  email: string;
  signedInEmail: string | null;
}) {
  const router = useRouter();
  const { d, fmt } = useT();
  const a = d.auth.invite;
  const ERROR_COPY: Record<string, string> = {
    invite_invalid: a.errInvalid,
    invite_used: a.errUsed,
    invite_revoked: a.errRevoked,
    invite_expired: a.errExpired,
    email_mismatch: a.errEmailMismatch,
    already_member_of_other_company: a.errOtherCompany,
    invalid_password: a.errInvalidPassword,
    login_required: a.errLoginRequired,
    accept_failed: a.errAcceptFailed,
  };
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const [loading, setLoading] = useState(false);

  const canOneClick =
    signedInEmail !== null && signedInEmail === email.toLowerCase();

  const submit = async (body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(data.redirectTo ?? "/dashboard/restaurant");
        router.refresh();
        return;
      }
      if (data.error === "account_exists") {
        setAccountExists(true);
      } else {
        setError(ERROR_COPY[data.error] ?? a.errGeneric);
      }
    } catch {
      setError(a.errGeneric);
    }
    setLoading(false);
  };

  if (accountExists) {
    return (
      <Alert>
        <AlertDescription className="space-y-2">
          <p>{a.accountExists}</p>
          <p>
            <Link href="/auth/login" className="text-primary hover:underline">
              {a.accountExistsLoginBefore}
            </Link>
            {a.accountExistsOr}
            <Link
              href="/auth/forgot-password"
              className="text-primary hover:underline"
            >
              {a.accountExistsReset}
            </Link>
            {a.accountExistsAfter}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (canOneClick) {
    return (
      <div className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          {fmt(a.signedInAs, { email })}
        </p>
        <Button
          className="w-full"
          disabled={loading}
          onClick={() => submit({ token })}
        >
          {loading ? a.joining : a.joinButton}
        </Button>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(a.passwordTooShort);
      return;
    }
    if (password !== confirm) {
      setError(a.passwordMismatch);
      return;
    }
    void submit({
      token,
      password,
      ...(fullName.trim() ? { full_name: fullName.trim() } : {}),
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {signedInEmail && (
        <Alert>
          <AlertDescription>{a.differentAccount}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="invite-email">{a.email}</Label>
        <Input id="invite-email" type="email" value={email} readOnly />
      </div>
      <div className="space-y-2">
        <Label htmlFor="full-name">{a.fullName}</Label>
        <Input
          id="full-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">{a.password}</Label>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">{a.confirm}</Label>
        <PasswordInput
          id="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading || !!signedInEmail}
      >
        {loading ? a.activating : a.activate}
      </Button>
    </form>
  );
}
