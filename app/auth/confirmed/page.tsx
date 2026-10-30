// app/auth/confirmed/page.tsx
//
// The confirmation link was opened where there is no session to start (another
// device or browser): the email IS confirmed, they just need to log in.

import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { requestLanguage } from "@/lib/restaurant/request-lang";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function EmailConfirmedPage() {
  const a = getDictionary(await requestLanguage()).auth.confirmedPage;
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{a.title}</CardTitle>
          <CardDescription>{a.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/auth/login">{a.login}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
