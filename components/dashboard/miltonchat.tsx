"use client";

import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { miltonEventsAPI } from "@/lib/milton-events";
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
import { MessageSquare, X, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MiltonChatProps {
  onClose?: () => void;
}

export default function MiltonChat({ onClose }: MiltonChatProps = {}) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chat = useChat();
  const { messages, setMessages } = chat;
  const hasPromptedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentUserMsgIdRef = useRef<string | null>(null);
  const currentAssistantMsgIdRef = useRef<string | null>(null);

  const cancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);

    // Remove the user message and assistant placeholder if they exist
    if (currentUserMsgIdRef.current || currentAssistantMsgIdRef.current) {
      setMessages((prev) => {
        const filtered = prev.filter((msg: any) => {
          return (
            msg.id !== currentUserMsgIdRef.current &&
            msg.id !== currentAssistantMsgIdRef.current
          );
        });
        return filtered;
      });
      currentUserMsgIdRef.current = null;
      currentAssistantMsgIdRef.current = null;
    }
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isLoading) {
      console.log("sendMessage: skipping - empty or loading", {
        userMessage,
        isLoading,
      });
      return;
    }

    console.log("sendMessage: starting", userMessage);
    setIsLoading(true);

    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMsgId = Date.now().toString();
    currentUserMsgIdRef.current = userMsgId;

    const userMsg = {
      id: userMsgId,
      role: "user" as const,
      parts: [
        {
          type: "text",
          text: userMessage.trim(),
        },
      ],
    };

    // Add user message to the chat
    setMessages((prev) => [...prev, userMsg] as any);

    try {
      // Prepare messages for API in UIMessage format (with parts array)
      const messagesForAPI = [
        ...messages.map((msg: any) => {
          // If message already has parts, use it; otherwise convert content to parts format
          if (msg.parts && Array.isArray(msg.parts)) {
            return {
              role: msg.role,
              parts: msg.parts,
            };
          }
          return {
            role: msg.role,
            parts: [
              {
                type: "text",
                text: msg.content || "",
              },
            ],
          };
        }),
        {
          role: "user" as const,
          parts: [
            {
              type: "text",
              text: userMessage.trim(),
            },
          ],
        },
      ];

      console.log("sendMessage: calling API", messagesForAPI);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: messagesForAPI }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      // Handle streaming response (AI SDK format)
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";
      const assistantMsgId = (Date.now() + 1).toString();
      currentAssistantMsgIdRef.current = assistantMsgId;

      // Add assistant message placeholder
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "",
            },
          ],
        } as any,
      ]);

      if (reader) {
        let buffer = "";
        while (true) {
          // Check if request was cancelled
          if (abortController.signal.aborted) {
            reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process complete lines (SSE format: "data: {...}\n\n")
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === "" || trimmedLine === "[DONE]") continue;

            // SSE format: lines start with "data: " followed by JSON
            if (trimmedLine.startsWith("data: ")) {
              try {
                const jsonStr = trimmedLine.slice(6); // Remove "data: " prefix
                const data = JSON.parse(jsonStr);

                if (data.type === "text-delta" && data.delta) {
                  assistantMessage += data.delta;
                  // Update the assistant message
                  setMessages((prev) =>
                    prev.map((msg: any) =>
                      msg.id === assistantMsgId
                        ? {
                            ...msg,
                            parts: [
                              {
                                type: "text",
                                text: assistantMessage,
                              },
                            ],
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
                            parts: [
                              {
                                type: "text",
                                text: assistantMessage,
                              },
                            ],
                          }
                        : msg
                    )
                  );
                }
              } catch {
                // Ignore parse errors for non-JSON lines
              }
            }
          }
        }
      }
    } catch (error) {
      // Don't show error if request was cancelled
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Request was cancelled");
        return;
      }

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
      console.log("sendMessage: finished");
    }
  };

  // Listen once for dataset readiness → single prompt
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
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-2 hover:bg-muted rounded-lg transition-colors bg-background/80 backdrop-blur-sm"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="flex-1 overflow-hidden rounded-lg border flex flex-col">
        <Conversation className="flex-1 min-h-0">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<MessageSquare className="size-12" />}
                title="Start a conversation"
                description="Ask Milton about your data..."
              />
            ) : (
              messages.map((message: any) => (
                <Message
                  from={message.role === "user" ? "user" : "assistant"}
                  key={message.id}
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
      <Input
        onSubmit={(e) => {
          e.preventDefault();
          console.log("Form submitted", input);
          const trimmedInput = input.trim();
          if (trimmedInput) {
            sendMessage(trimmedInput);
            setInput("");
          }
        }}
        className="mt-4 w-full relative"
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
