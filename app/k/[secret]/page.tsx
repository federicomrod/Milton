// app/k/[secret]/page.tsx
//
// Public landing for a kitchen app invite link. It only shows the code; it
// never looks the invite up or redeems it (the app does that). Universal
// links are #433. No cookies, no data access, not indexed, no referrer.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  appInviteCopy,
  inviteLangFromHeader,
} from "@/lib/restaurant/kitchen/app-invite-copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Milton",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const CODE_SHAPE = /^[A-Za-z0-9_-]{16,200}$/;

export default async function KitchenInviteLanding({
  params,
}: {
  params: Promise<{ secret: string }>;
}) {
  const { secret } = await params;
  if (!CODE_SHAPE.test(secret)) notFound();
  const { page } = appInviteCopy(
    inviteLangFromHeader((await headers()).get("accept-language"))
  );
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center text-[#0F172A]">
      <h1 className="text-xl font-semibold text-[#1B40C8]">{page.heading}</h1>
      <p className="text-base">{page.instruction}</p>
      <p
        data-testid="kitchen-invite-code"
        className="w-full break-all rounded-md border border-[#E5E7EB] px-4 py-5 font-mono text-2xl font-semibold"
      >
        {secret}
      </p>
      <p className="text-sm text-muted-foreground">{page.note}</p>
    </main>
  );
}
