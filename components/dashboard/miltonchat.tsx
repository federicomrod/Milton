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
import { MessageSquare } from "lucide-react";

export default function MiltonChat() {
  const [input, setInput] = useState("");
  const chat = useChat({
    transport: {
      url: "/api/chat",
      method: "POST",
    },
  } as any);
  const { messages, sendMessage, status, setMessages } = chat;
  const hasPromptedRef = useRef(false);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({
        role: "user",
        parts: [{ type: "text", text: input.trim() }],
      } as any);
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden rounded-lg border">
        <Conversation>
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
                    {message.parts && message.parts.length > 0
                      ? message.parts.map((part: any, idx: number) => {
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
                      : null}
                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>
      <Input onSubmit={handleSubmit} className="mt-4 w-full relative">
        <PromptInputTextarea
          value={input}
          placeholder="Ask Milton about your data..."
          onChange={(e) => setInput(e.currentTarget.value)}
          className="pr-12"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <PromptInputSubmit
          status={status === "streaming" ? "streaming" : "ready"}
          disabled={!input.trim()}
          className="absolute bottom-1 right-1"
        />
      </Input>
    </div>
  );
}
