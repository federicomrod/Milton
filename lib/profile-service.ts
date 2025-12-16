"use client";
import { createClient } from "@/lib/supabase/client";

export interface UserProfile {
  user_id: string;
  id?: string;
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

export async function getUserCompany(): Promise<Company | null> {
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

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .update({
      ...companyData,
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
