"use client";

import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { miltonEventsAPI } from "@/lib/milton-events";
import { useDashboardKpis } from "@/lib/context/DashboardKpisContext";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Input,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  Bot,
  Settings,
  X,
  StopCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatSettings } from "@/app/api/chat/route";

const SETTINGS_STORAGE_KEY = "milton-chat-settings";
const DATE_RANGE_STORAGE_KEY = "dashboard-date-range";

function readDateRange(): {
  period: string;
  customDateRange?: { from: string; to: string };
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DATE_RANGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.period &&
      parsed?.customDateRange?.from &&
      parsed?.customDateRange?.to
    ) {
      return parsed;
    }
  } catch {}
  return null;
}

const DEFAULT_SETTINGS: ChatSettings = {
  responseLength: "concise",
  tone: "direct",
};

function loadSettings(): ChatSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveSettings(s: ChatSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

interface MiltonChatProps {
  onClose?: () => void;
}

type SettingOption<T extends string> = { value: T; label: string };

const LENGTH_OPTIONS: SettingOption<ChatSettings["responseLength"]>[] = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed" },
];

const TONE_OPTIONS: SettingOption<ChatSettings["tone"]>[] = [
  { value: "direct", label: "Direct" },
  { value: "friendly", label: "Friendly" },
  { value: "formal", label: "Formal" },
];

export default function MiltonChat({ onClose }: MiltonChatProps = {}) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const { kpis: dashboardKpis } = useDashboardKpis();
  const chat = useChat();
  const { messages, setMessages } = chat;
  const hasPromptedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentUserMsgIdRef = useRef<string | null>(null);
  const currentAssistantMsgIdRef = useRef<string | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const updateSetting = <K extends keyof ChatSettings>(
    key: K,
    value: ChatSettings[K]
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  };

  const cancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);

    if (currentUserMsgIdRef.current || currentAssistantMsgIdRef.current) {
      setMessages((prev) => {
        return prev.filter(
          (msg: any) =>
            msg.id !== currentUserMsgIdRef.current &&
            msg.id !== currentAssistantMsgIdRef.current
        );
      });
      currentUserMsgIdRef.current = null;
      currentAssistantMsgIdRef.current = null;
    }
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isLoading) return;

    setIsLoading(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMsgId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    currentUserMsgIdRef.current = userMsgId;

    const userMsg = {
      id: userMsgId,
      role: "user" as const,
      parts: [{ type: "text", text: userMessage.trim() }],
    };

    setMessages((prev) => [...prev, userMsg] as any);

    try {
      const messagesForAPI = [
        ...messages.map((msg: any) => {
          if (msg.parts && Array.isArray(msg.parts)) {
            return { role: msg.role, parts: msg.parts };
          }
          return {
            role: msg.role,
            parts: [{ type: "text", text: msg.content || "" }],
          };
        }),
        {
          role: "user" as const,
          parts: [{ type: "text", text: userMessage.trim() }],
        },
      ];

      const dateRange = readDateRange();

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesForAPI,
          settings,
          dateRange: dateRange ?? undefined,
          dashboardKpis: dashboardKpis?.length ? dashboardKpis : undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";
      const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      currentAssistantMsgIdRef.current = assistantMsgId;

      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          parts: [{ type: "text", text: "" }],
        } as any,
      ]);

      if (reader) {
        let buffer = "";
        while (true) {
          if (abortController.signal.aborted) {
            reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === "" || trimmedLine === "[DONE]") continue;

            if (trimmedLine.startsWith("data: ")) {
              try {
                const jsonStr = trimmedLine.slice(6);
                const data = JSON.parse(jsonStr);

                if (data.type === "text-delta" && data.delta) {
                  assistantMessage += data.delta;
                  setMessages((prev) =>
                    prev.map((msg: any) =>
                      msg.id === assistantMsgId
                        ? {
                            ...msg,
                            parts: [{ type: "text", text: assistantMessage }],
                          }
                        : msg
                    )
                  );
                } else if (data.type === "text" && data.text) {
                  assistantMessage = data.text;
                  setMessages((prev) =>
                    prev.map((msg: any) =>
                      msg.id === assistantMsgId
                        ? {
                            ...msg,
                            parts: [{ type: "text", text: assistantMessage }],
                          }
                        : msg
                    )
                  );
                }
              } catch {
                // ignore non-JSON lines
              }
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;

      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Unknown error"}. Please try again.`,
            },
          ],
        } as any,
      ]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      currentUserMsgIdRef.current = null;
      currentAssistantMsgIdRef.current = null;
    }
  };

  // Listen once for dataset readiness
  useEffect(() => {
    const unsubscribe = miltonEventsAPI.subscribe("datasets.linked", () => {
      if (hasPromptedRef.current) return;
      hasPromptedRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "✅ All data sources are linked. Would you like me to generate insights?",
            },
          ],
        } as any,
      ]);
    });
    return () => unsubscribe();
  }, [setMessages]);

  // Listen for dashboard data ready
  useEffect(() => {
    const unsubscribeDashboard = miltonEventsAPI.subscribe(
      "dashboard.data.ready",
      (payload) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            parts: [
              {
                type: "text",
                text: `✅ Dashboard ready! I've generated visuals for your key KPIs under the ${payload.businessModel.replace("_", " ")} model.`,
              },
            ],
          } as any,
        ]);
      }
    );
    return () => unsubscribeDashboard();
  }, [setMessages]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-background shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Talk to Milton</p>
            <p className="text-xs text-muted-foreground leading-none mt-0.5">
              AI business analyst
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Chat settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b bg-muted/40 px-3 py-3 shrink-0 space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Response length
            </p>
            <div className="flex gap-1.5">
              {LENGTH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateSetting("responseLength", opt.value)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    settings.responseLength === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Tone
            </p>
            <div className="flex gap-1.5">
              {TONE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateSetting("tone", opt.value)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    settings.tone === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Settings apply to new messages. Saved locally.
          </p>
        </div>
      )}

      {/* Conversation */}
      <div className="flex-1 overflow-hidden rounded-b-lg border-x border-b flex flex-col min-h-0">
        <Conversation className="flex-1 min-h-0">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<Bot className="size-10 text-primary/60" />}
                title="Talk to Milton"
                description="Ask about your KPIs, revenue, or data."
              />
            ) : (
              messages.map((message: any, index: number) => (
                <Message
                  from={message.role === "user" ? "user" : "assistant"}
                  key={message.id || `message-${index}`}
                >
                  <MessageContent>
                    {message.content ? (
                      <MessageResponse
                        from={message.role === "user" ? "user" : "assistant"}
                      >
                        {message.content}
                      </MessageResponse>
                    ) : message.parts && message.parts.length > 0 ? (
                      message.parts.map((part: any, idx: number) => {
                        if (part.type === "text") {
                          return (
                            <MessageResponse
                              key={idx}
                              from={
                                message.role === "user" ? "user" : "assistant"
                              }
                            >
                              {part.text}
                            </MessageResponse>
                          );
                        }
                        return null;
                      })
                    ) : null}
                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input */}
      <Input
        onSubmit={(e) => {
          e.preventDefault();
          const trimmedInput = input.trim();
          if (trimmedInput) {
            sendMessage(trimmedInput);
            setInput("");
          }
        }}
        className="mt-3 w-full relative"
      >
        <PromptInputTextarea
          value={input}
          placeholder="Ask Milton about your data..."
          onChange={(e) => setInput(e.currentTarget.value)}
          className="pr-12"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const trimmedInput = input.trim();
              if (trimmedInput) {
                sendMessage(trimmedInput);
                setInput("");
              }
            }
          }}
        />
        {isLoading ? (
          <Button
            type="button"
            onClick={cancelRequest}
            size="icon"
            variant="default"
            className="absolute bottom-1 right-1 shrink-0"
            aria-label="Cancel request"
          >
            <StopCircle className="size-4" />
          </Button>
        ) : (
          <PromptInputSubmit
            status="ready"
            disabled={!input.trim()}
            className="absolute bottom-1 right-1"
          />
        )}
      </Input>
    </div>
  );
}
