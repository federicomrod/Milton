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
  created_at?: string;
  updated_at?: string;
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
    .single();

  if (error) {
    console.error("Error fetching user profile:", error.message);
    return null;
  }

  return data as UserProfile;
}

export async function upsertUserProfile(
  profileData: Partial<UserProfile>
): Promise<UserProfile> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("Auth error (upsertUserProfile):", userError);
  if (!user) throw new Error("User not authenticated");

  // Remove fields that don't belong in profiles - they're in other tables
  const { email, company_name, industry, ...cleanProfileData } =
    profileData as any;

  const payload = {
    ...cleanProfileData,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };

  // ✅ This is the key line — ensures updates occur by user_id (not id)
  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    console.error(
      "Profile update error:",
      error.message,
      error.details,
      error.hint
    );
    throw error;
  }

  return data as UserProfile;
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

/**
 * Check if a user has admin role
 */
export async function isUserAdmin(userId?: string): Promise<boolean> {
  const supabase = createClient();
  const userIdToCheck = userId || (await supabase.auth.getUser()).data.user?.id;

  if (!userIdToCheck) {
    return false;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userIdToCheck)
    .single();

  if (error) {
    console.error("Error checking admin status:", error.message);
    return false;
  }

  return data?.role === "admin";
}

/**
 * Get the role of a user
 */
export async function getUserRole(userId?: string): Promise<UserRole> {
  const supabase = createClient();
  const userIdToCheck = userId || (await supabase.auth.getUser()).data.user?.id;

  if (!userIdToCheck) {
    return "user";
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userIdToCheck)
    .single();

  if (error) {
    console.error("Error fetching user role:", error.message);
    return "user";
  }

  return (data?.role as UserRole) || "user";
}
