"use client";

import { createClient } from "@/lib/supabase/client";

export type OnboardingMessage = {
  from: "milton" | "user";
  text: string;
  timestamp?: string;
};

export type ArchivedConversation = {
  messages: OnboardingMessage[];
  archivedAt: string;
  completedOnboarding: boolean;
};

/**
 * Save the current onboarding chat messages
 */
export async function saveOnboardingChat(
  messages: OnboardingMessage[]
): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("No user found for saving onboarding chat");
      return false;
    }

    // Add timestamps to messages if not present
    const messagesWithTimestamp = messages.map((msg) => ({
      ...msg,
      timestamp: msg.timestamp || new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("companies")
      .update({ current_onboarding_chat: messagesWithTimestamp })
      .eq("created_by", user.id);

    if (error) {
      console.error("Error saving onboarding chat:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error saving onboarding chat:", error);
    return false;
  }
}

/**
 * Archive the current conversation and clear it (when user starts over)
 */
export async function archiveAndClearOnboardingChat(): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("No user found for archiving onboarding chat");
      return false;
    }

    // Get current chat and history
    const { data: company, error: fetchError } = await supabase
      .from("companies")
      .select("current_onboarding_chat, onboarding_chat_history")
      .eq("created_by", user.id)
      .single();

    if (fetchError || !company) {
      console.error("Error fetching company for archiving:", fetchError);
      return false;
    }

    const currentChat = company.current_onboarding_chat as
      | OnboardingMessage[]
      | null;
    const history =
      (company.onboarding_chat_history as ArchivedConversation[]) || [];

    // Only archive if there's a current chat with messages
    if (currentChat && currentChat.length > 0) {
      const archived: ArchivedConversation = {
        messages: currentChat,
        archivedAt: new Date().toISOString(),
        completedOnboarding: false,
      };

      const { error: updateError } = await supabase
        .from("companies")
        .update({
          current_onboarding_chat: null,
          onboarding_chat_history: [...history, archived],
        })
        .eq("created_by", user.id);

      if (updateError) {
        console.error("Error archiving onboarding chat:", updateError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Error archiving onboarding chat:", error);
    return false;
  }
}

/**
 * Mark the current conversation as completed and archive it
 */
export async function completeOnboardingChat(): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return false;
    }

    // Get current chat
    const { data: company, error: fetchError } = await supabase
      .from("companies")
      .select("current_onboarding_chat, onboarding_chat_history")
      .eq("created_by", user.id)
      .single();

    if (fetchError || !company) {
      return false;
    }

    const currentChat = company.current_onboarding_chat as
      | OnboardingMessage[]
      | null;
    const history =
      (company.onboarding_chat_history as ArchivedConversation[]) || [];

    if (currentChat && currentChat.length > 0) {
      const archived: ArchivedConversation = {
        messages: currentChat,
        archivedAt: new Date().toISOString(),
        completedOnboarding: true,
      };

      await supabase
        .from("companies")
        .update({
          current_onboarding_chat: null,
          onboarding_chat_history: [...history, archived],
        })
        .eq("created_by", user.id);
    }

    return true;
  } catch (error) {
    console.error("Error completing onboarding chat:", error);
    return false;
  }
}

/**
 * Load the current onboarding chat (if any)
 */
export async function loadOnboardingChat(): Promise<
  OnboardingMessage[] | null
> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const { data: company, error } = await supabase
      .from("companies")
      .select("current_onboarding_chat")
      .eq("created_by", user.id)
      .single();

    if (error || !company) {
      return null;
    }

    return company.current_onboarding_chat as OnboardingMessage[] | null;
  } catch (error) {
    console.error("Error loading onboarding chat:", error);
    return null;
  }
}

/**
 * Get all archived conversations for a company
 */
export async function getArchivedConversations(): Promise<
  ArchivedConversation[]
> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return [];
    }

    const { data: company, error } = await supabase
      .from("companies")
      .select("onboarding_chat_history")
      .eq("created_by", user.id)
      .single();

    if (error || !company) {
      return [];
    }

    return (company.onboarding_chat_history as ArchivedConversation[]) || [];
  } catch (error) {
    console.error("Error loading archived conversations:", error);
    return [];
  }
}
