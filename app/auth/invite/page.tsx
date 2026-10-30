// app/auth/invite/page.tsx
//
// Public activation page for workspace invites (R1 item 2). The token is
// validated server-side (hash lookup via the admin client). Shows the
// workspace name and invited email read-only; expired / used / revoked /
// unknown tokens each get a clear error that reveals nothing else. A
// signed-in user whose email matches sees one-click "Join workspace"
// instead of the password form.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInviteStatus, hashInviteToken } from "@/lib/auth/invite-token";
import { getDictionary, fmt } from "@/lib/i18n";
import { requestLanguage } from "@/lib/restaurant/request-lang";
import { InviteAcceptForm } from "@/components/auth/invite-accept-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const a = getDictionary(await requestLanguage()).auth.invite;
  const ERROR_COPY: Record<string, string> = {
    invalid: a.stateInvalid,
    expired: a.stateExpired,
    accepted: a.stateAccepted,
    revoked: a.stateRevoked,
  };
  const token = typeof sp.token === "string" ? sp.token : "";

  let state: "invalid" | "expired" | "accepted" | "revoked" | "pending" =
    "invalid";
  let workspaceName = "";
  let inviteEmail = "";
  let signedInEmail: string | null = null;

  if (token && token.length <= 200) {
    try {
      const admin = createAdminClient();
      const { data: invite } = await admin
        .from("workspace_invites")
        .select("company_id, email, expires_at, accepted_at, revoked_at")
        .eq("token_hash", hashInviteToken(token))
        .maybeSingle();
      if (invite) {
        state = getInviteStatus(invite);
        if (state === "pending") {
          inviteEmail = invite.email as string;
          const { data: company } = await admin
            .from("companies")
            .select("name")
            .eq("id", invite.company_id)
            .maybeSingle();
          workspaceName = (company?.name as string) ?? a.yourWorkspace;
          const supabase = await createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          signedInEmail = user?.email?.toLowerCase() ?? null;
        }
      }
    } catch {
      state = "invalid";
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {state === "pending"
              ? fmt(a.join, { workspace: workspaceName })
              : a.unavailable}
          </CardTitle>
          <CardDescription>
            {state === "pending" ? a.activateDescription : a.askNewLink}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state !== "pending" && (
            <Alert variant="destructive">
              <AlertDescription>
                {ERROR_COPY[state]} {a.askNewLink}
              </AlertDescription>
            </Alert>
          )}
          {state === "pending" && (
            <InviteAcceptForm
              token={token}
              email={inviteEmail}
              signedInEmail={signedInEmail}
            />
          )}
          <p className="text-sm text-center text-muted-foreground">
            <Link href="/auth/login" className="text-primary hover:underline">
              {a.backToLogin}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
