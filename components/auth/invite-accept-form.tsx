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
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const MIN_PASSWORD = 8;

const ERROR_COPY: Record<string, string> = {
  invite_invalid:
    "This invite link isn't valid. Ask your Milton contact for a new link.",
  invite_used: "This invite link has already been used.",
  invite_revoked:
    "This invite has been cancelled. Ask your Milton contact for a new link.",
  invite_expired:
    "This invite link has expired. Ask your Milton contact for a new link.",
  email_mismatch:
    "You're signed in with a different email than the one invited. Log out and use the invited email.",
  already_member_of_other_company:
    "This account already belongs to another workspace, so it can't join this one.",
  invalid_password: "Password must be between 8 and 72 characters.",
  login_required:
    "Please log in with the invited email, then reopen this link.",
};

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
        setError(
          ERROR_COPY[data.error] ?? "Something went wrong. Please try again."
        );
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  if (accountExists) {
    return (
      <Alert>
        <AlertDescription className="space-y-2">
          <p>
            An account with this email already exists, so we can&apos;t set a
            new password from this link.
          </p>
          <p>
            <Link href="/auth/login" className="text-primary hover:underline">
              Log in
            </Link>{" "}
            (or{" "}
            <Link
              href="/auth/forgot-password"
              className="text-primary hover:underline"
            >
              reset your password
            </Link>
            ), then open this invite link again to join the workspace.
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
          You&apos;re signed in as {email}.
        </p>
        <Button
          className="w-full"
          disabled={loading}
          onClick={() => submit({ token })}
        >
          {loading ? "Joining..." : "Join workspace"}
        </Button>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
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
          <AlertDescription>
            You&apos;re signed in with a different account. Log out to activate
            this invite.
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" type="email" value={email} readOnly />
      </div>
      <div className="space-y-2">
        <Label htmlFor="full-name">Full name (optional)</Label>
        <Input
          id="full-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">Password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
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
        {loading ? "Activating..." : "Activate account"}
      </Button>
    </form>
  );
}
