// milton://k/<secret> opens the app on the join screen with the code filled in.
// (Universal links, https://…/k/<secret>, come with push in a later PR.)

import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useSession } from "../../session/SessionProvider";

export default function InviteLink() {
  const { secret } = useLocalSearchParams<{ secret: string }>();
  const { status } = useSession();
  if (status === "loading") return null;
  if (status === "signedIn") return <Redirect href="/" />;
  return (
    <Redirect
      href={{ pathname: "/join", params: { secret: String(secret ?? "") } }}
    />
  );
}
