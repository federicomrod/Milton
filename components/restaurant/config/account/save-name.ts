"use client";

// Saves the person's own name: the `profiles` row (RLS: own row only) and the
// Auth metadata the shell greeting reads. Never takes a user id from the UI.
import { createClient } from "@/lib/supabase/client";

export async function saveFullName(name: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not_authenticated");
  const clean = name.trim();
  const { error: authError } = await supabase.auth.updateUser({
    data: { full_name: clean },
  });
  if (authError) throw authError;
  // Best effort: the profile row mirrors the name for team lists.
  await supabase
    .from("profiles")
    .update({ full_name: clean })
    .eq("id", user.id);
}

export async function changePassword(password: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error("password_update_failed");
}
