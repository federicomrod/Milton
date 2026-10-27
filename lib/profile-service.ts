"use client";
import { createClient } from "@/lib/supabase/client";

import type { UserRole } from "@/lib/types/data";

export interface UserProfile {
  user_id: string;
  id?: string;
  role: UserRole;
  timezone?: string;
  currency?: string;
  date_format?: string;
  number_format?: string;
  theme?: string;
  billing_status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  created_by: string;
  /** Display currency derived from the company's data (GET only). */
  currency?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Display preferences (zona horaria, formatos, tema) are per person and live
 * in the Supabase Auth user metadata. The `profiles` table has NO
 * timezone / currency / date_format / number_format / theme columns (see
 * supabase/migrations/001_baseline.sql), so writing them there always
 * failed with «No pudimos guardar tus cambios». No migration needed.
 * Currency is not a personal preference: it comes from the company's data.
 */
export interface DisplayPreferences {
  timezone?: string;
  date_format?: string;
  number_format?: string;
  theme?: string;
}

export const PREFERENCE_KEYS = [
  "timezone",
  "date_format",
  "number_format",
  "theme",
] as const;

export function pickPreferences(source: unknown): DisplayPreferences {
  const out: DisplayPreferences = {};
  if (!source || typeof source !== "object") return out;
  const record = source as Record<string, unknown>;
  for (const key of PREFERENCE_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() && value.length <= 64) {
      out[key] = value.trim();
    }
  }
  return out;
}

/** The device's time zone: a better first guess than a fixed European one. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Saved preferences of an auth user (empty object when none). */
export function preferencesFromAuthUser(user: unknown): DisplayPreferences {
  const meta = (user as { user_metadata?: { preferences?: unknown } } | null)
    ?.user_metadata;
  return pickPreferences(meta?.preferences);
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("Auth error (getUserProfile):", userError);
  if (!user) {
    console.warn("No authenticated user found in getUserProfile()");
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error fetching user profile:", error.message);
  }

  return {
    ...((data ?? {}) as Partial<UserProfile>),
    user_id: user.id,
    role: ((data as UserProfile | null)?.role ?? "user") as UserRole,
    created_at:
      (data as UserProfile | null)?.created_at ?? user.created_at ?? undefined,
    ...preferencesFromAuthUser(user),
  } as UserProfile;
}

/** Save the person's display preferences (Auth user metadata, not `profiles`). */
export async function saveUserPreferences(
  prefs: Partial<UserProfile>
): Promise<DisplayPreferences> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("Auth error (saveUserPreferences):", userError);
  if (!user) throw new Error("User not authenticated");

  const next = {
    ...preferencesFromAuthUser(user),
    ...pickPreferences(prefs),
  };
  const { error } = await supabase.auth.updateUser({
    data: { preferences: next },
  });
  if (error) {
    console.error("Preferences update error:", error.message);
    throw error;
  }
  return next;
}

/** @deprecated profiles has no preference columns; kept for old callers. */
export async function upsertUserProfile(
  profileData: Partial<UserProfile>
): Promise<UserProfile> {
  const saved = await saveUserPreferences(profileData);
  return { ...(profileData as UserProfile), ...saved };
}

/**
 * The company of the signed-in person, read through their membership
 * (restaurant accounts have no `companies.created_by`). Null when the
 * request fails, so callers fall back to the legacy lookup.
 */
async function fetchMemberCompany(): Promise<Company | null> {
  try {
    const res = await fetch("/api/restaurant/company", {
      credentials: "include",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { company?: Company | null };
    return json.company ?? null;
  } catch {
    return null;
  }
}

export async function getUserCompany(): Promise<Company | null> {
  const member = await fetchMemberCompany();
  if (member) return member;
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("Auth error (getUserCompany):", userError);
  if (!user) {
    console.warn("No authenticated user found in getUserCompany()");
    return null;
  }

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("created_by", user.id)
    .single();

  if (error) {
    console.error("Error fetching company:", error.message);
    return null;
  }

  return data as Company;
}

/** A company save the server refused, with its plain-Spanish reason. */
export class CompanySaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanySaveError";
  }
}

export async function updateCompany(
  companyData: Partial<Company>
): Promise<Company> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("Auth error (updateCompany):", userError);
  if (!user) throw new Error("User not authenticated");

  // Restaurant accounts: rename through the membership (the legacy
  // `created_by` update below matches nothing for them).
  if (typeof companyData.name === "string" && companyData.name.trim()) {
    const res = await fetch("/api/restaurant/company", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: companyData.name }),
    }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json()) as { company: Company };
      return json.company;
    }
    // A member who may not rename, or a bad name: say why. Falling through
    // to the legacy `created_by` update would only fail with a vaguer error.
    if (res && (res.status === 400 || res.status === 403)) {
      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new CompanySaveError(
        json?.error || "No pudimos guardar el nombre de la empresa."
      );
    }
  }

  // Filter out fields that don't exist in the companies table
  const {
    industry,
    id,
    created_by,
    created_at,
    updated_at,
    ...validCompanyData
  } = companyData as any;

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .update({
      ...validCompanyData,
      updated_at: new Date().toISOString(),
    })
    .eq("created_by", user.id)
    .select()
    .single();

  if (companyError) {
    console.error(
      "Company update error:",
      companyError.message,
      companyError.details,
      companyError.hint
    );
    throw companyError;
  }

  return company as Company;
}
