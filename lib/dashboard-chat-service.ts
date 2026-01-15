// lib/dashboard-chat-service.ts
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{
    type: "text";
    text: string;
  }>;
  created_at?: string;
};

export type ArchivedConversation = {
  id: string;
  title: string;
  messages: DashboardMessage[];
  created_at: string;
  updated_at: string;
};

/**
 * Save the current dashboard chat messages
 */
export async function saveDashboardChat(
  messages: DashboardMessage[]
): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("No user found for saving dashboard chat");
      return false;
    }

    // Get user's company
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      console.error("No company found for saving dashboard chat");
      return false;
    }

    // Add timestamps to messages if not present
    const messagesWithTimestamp = messages.map((msg) => ({
      ...msg,
      created_at: msg.created_at || new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("companies")
      .update({ current_dashboard_chat: messagesWithTimestamp })
      .eq("id", company.id);

    if (error) {
      console.error("Error saving dashboard chat:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error saving dashboard chat:", error);
    return false;
  }
}

/**
 * Load the current dashboard chat (if any)
 */
export async function loadDashboardChat(): Promise<DashboardMessage[] | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const { data: company } = await supabase
      .from("companies")
      .select("current_dashboard_chat")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return null;
    }

    return (company.current_dashboard_chat as DashboardMessage[]) || null;
  } catch (error) {
    console.error("Error loading dashboard chat:", error);
    return null;
  }
}

/**
 * Archive the current conversation and start a new one
 */
export async function archiveDashboardConversation(
  title?: string
): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("No user found for archiving dashboard chat");
      return false;
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id, current_dashboard_chat, dashboard_chat_history")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return false;
    }

    const currentChat = company.current_dashboard_chat as
      | DashboardMessage[]
      | null;
    const history =
      (company.dashboard_chat_history as ArchivedConversation[]) || [];

    // Only archive if there's a current chat with messages
    if (currentChat && currentChat.length > 0) {
      // Generate title from first user message if not provided
      const conversationTitle =
        title ||
        currentChat
          .find((msg) => msg.role === "user")
          ?.parts?.[0]?.text?.slice(0, 50) ||
        "New Conversation";

      const archived: ArchivedConversation = {
        id: Date.now().toString(),
        title: conversationTitle,
        messages: currentChat,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from("companies")
        .update({
          current_dashboard_chat: null,
          dashboard_chat_history: [...history, archived],
        })
        .eq("id", company.id);

      if (updateError) {
        console.error("Error archiving dashboard chat:", updateError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Error archiving dashboard chat:", error);
    return false;
  }
}

/**
 * Get all archived conversations for a company
 */
export async function getArchivedDashboardConversations(): Promise<
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

    const { data: company } = await supabase
      .from("companies")
      .select("dashboard_chat_history")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return [];
    }

    return (company.dashboard_chat_history as ArchivedConversation[]) || [];
  } catch (error) {
    console.error("Error loading archived conversations:", error);
    return [];
  }
}

/**
 * Load a specific archived conversation
 */
export async function loadArchivedConversation(
  conversationId: string
): Promise<DashboardMessage[] | null> {
  try {
    const conversations = await getArchivedDashboardConversations();
    const conversation = conversations.find((c) => c.id === conversationId);
    return conversation?.messages || null;
  } catch (error) {
    console.error("Error loading archived conversation:", error);
    return null;
  }
}

/**
 * Delete an archived conversation
 */
export async function deleteArchivedConversation(
  conversationId: string
): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return false;
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id, dashboard_chat_history")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return false;
    }

    const history =
      (company.dashboard_chat_history as ArchivedConversation[]) || [];
    const filtered = history.filter((c) => c.id !== conversationId);

    const { error } = await supabase
      .from("companies")
      .update({ dashboard_chat_history: filtered })
      .eq("id", company.id);

    if (error) {
      console.error("Error deleting archived conversation:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error deleting archived conversation:", error);
    return false;
  }
}
