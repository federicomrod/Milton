"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, MessageSquare } from "lucide-react";
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
  getBusinessModelTemplates,
  type BusinessTypeDefinition,
} from "@/lib/business-model-templates";
import type { BusinessTypeId } from "@/lib/business-types";

interface MiltonChatProps {
  onFinish: (answers: {
    industry: string;
    employees: string;
    goals: string;
    revenue: string;
    dataSources: string;
    systems: string;
    businessDescription: string;
    businessType?: BusinessTypeId;
  }) => void;
  messages: { from: "milton" | "user"; text: string }[];
  setMessages: React.Dispatch<
    React.SetStateAction<{ from: "milton" | "user"; text: string }[]>
  >;
}

export default function MiltonChat({
  onFinish,
  messages,
  setMessages,
}: MiltonChatProps) {
  const [step, setStep] = useState<
    | "intro"
    | "businessType"
    | "employees"
    | "goals"
    | "revenue"
    | "data"
    | "systems"
    | "confirm"
    | "done"
  >("intro");
  const [input, setInput] = useState("");
  const [selectedBusinessType, setSelectedBusinessType] =
    useState<BusinessTypeId | null>(null);
  const [businessTypes, setBusinessTypes] = useState<BusinessTypeDefinition[]>(
    []
  );
  const [answers, setAnswers] = useState<{
    industry?: string;
    employees?: string;
    goals?: string;
    revenue?: string;
    dataSources?: string;
    systems?: string;
    businessDescription?: string;
    businessType?: BusinessTypeId;
  }>({});
  const hasFinishedRef = React.useRef(false);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          from: "milton",
          text: "Hi, I'm Milton 👋 — your AI finance copilot.",
        },
        {
          from: "milton",
          text: "I'll help you track your finances, understand your KPIs, and make data-driven decisions. Let's get started!",
        },
        {
          from: "milton",
          text: "Can I ask you a few quick questions to set up your workspace?",
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch business model templates from Supabase
  useEffect(() => {
    const loadBusinessTypes = async () => {
      const types = await getBusinessModelTemplates();
      setBusinessTypes(types);
    };
    loadBusinessTypes();
  }, []);

  function sendUserMessage(text: string) {
    setMessages((prev) => [...prev, { from: "user", text }]);
    setInput("");
  }

  function nextStep() {
    if (step === "intro") {
      setStep("businessType");
      setMessages((prev) => [
        ...prev,
        { from: "user", text: "Yes, let's start" },
        {
          from: "milton",
          text: "Great! What type of business are you running?",
        },
      ]);
    } else if (step === "businessType") {
      if (!selectedBusinessType) return;
      const businessType = businessTypes.find(
        (bt) => bt.id === selectedBusinessType
      );
      setStep("employees");
      setMessages((prev) => [
        ...prev,
        { from: "user", text: businessType?.label || selectedBusinessType },
        {
          from: "milton",
          text: `Perfect! I'll customize everything for ${businessType?.label || "your business"}. How many employees do you have?`,
        },
      ]);
    } else if (step === "employees") {
      setStep("goals");
      setMessages((prev) => [
        ...prev,
        {
          from: "milton",
          text: "Perfect. What are your main financial goals right now?",
        },
      ]);
    } else if (step === "goals") {
      setStep("revenue");
      setMessages((prev) => [
        ...prev,
        { from: "milton", text: "How does your company generate revenue?" },
      ]);
    } else if (step === "revenue") {
      setStep("data");
      setMessages((prev) => [
        ...prev,
        {
          from: "milton",
          text: "What kind of data do you already track or have in files?",
        },
      ]);
    } else if (step === "data") {
      setStep("systems");
      setMessages((prev) => [
        ...prev,
        {
          from: "milton",
          text: "Do you use any software systems like a CRM, Stripe, or ERP?",
        },
      ]);
    } else if (step === "systems") {
      setStep("confirm");

      // Log all collected answers for debugging
      console.log("📋 Onboarding answers collected:", {
        businessType: selectedBusinessType,
        businessTypeLabel: businessTypes.find(
          (bt) => bt.id === selectedBusinessType
        )?.label,
        employees: answers.employees,
        goals: answers.goals,
        revenue: answers.revenue,
        dataSources: answers.dataSources,
        systems: answers.systems,
        allAnswers: answers,
      });

      // Build summary message
      const businessTypeLabel =
        businessTypes.find((bt) => bt.id === selectedBusinessType)?.label ||
        "Unknown";
      const summary = [
        `Business Type: ${businessTypeLabel}`,
        `Employees: ${answers.employees || "Not specified"}`,
        `Goals: ${answers.goals || "Not specified"}`,
        `Revenue Model: ${answers.revenue || "Not specified"}`,
        `Data Sources: ${answers.dataSources || "Not specified"}`,
        `Systems: ${answers.systems || "Not specified"}`,
      ].join("\n\n");

      const summaryMessages = [
        {
          from: "milton" as const,
          text: "Thanks! Let me summarize what I understood and prepare your workspace.",
        },
        {
          from: "milton" as const,
          text: "Here's what I've gathered:",
        },
        // Render each summary item as a separate message for better formatting
        ...summary.split("\n\n").map((line) => ({
          from: "milton" as const,
          text: line,
        })),
        {
          from: "milton" as const,
          text: "Does this look correct?",
        },
      ];

      setMessages((prev) => [...prev, ...summaryMessages]);
    }
  }

  function finish(nextAnswers: {
    industry?: string;
    employees?: string;
    goals?: string;
    revenue?: string;
    dataSources?: string;
    systems?: string;
    businessDescription?: string;
  }) {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;

    setStep("done");
    setMessages((prev) => [
      ...prev,
      {
        from: "milton",
        text: "Awesome! Let me process this and prepare your KPI suggestions and data model proposal.",
      },
      {
        from: "milton",
        text: "Please hold on while I prepare everything. You'll be redirected shortly to your data model builder.",
      },
    ]);
    try {
      console.log("✅ Final answers ready for onFinish:", nextAnswers);
      // Ensure all required fields are strings (use empty string as fallback)
      onFinish({
        industry: nextAnswers.industry || "",
        employees: nextAnswers.employees || "",
        goals: nextAnswers.goals || "",
        revenue: nextAnswers.revenue || "",
        dataSources: nextAnswers.dataSources || "",
        systems: nextAnswers.systems || "",
        businessDescription: nextAnswers.businessDescription || "",
      });
    } catch (err) {
      console.error("Error finishing onboarding:", err);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    sendUserMessage(input);

    if (step === "employees") {
      setAnswers((a) => ({ ...a, employees: input }));
      console.log("📝 Employees answer:", input);
    } else if (step === "goals") {
      setAnswers((a) => ({ ...a, goals: input }));
      console.log("📝 Goals answer:", input);
    } else if (step === "revenue") {
      setAnswers((a) => ({ ...a, revenue: input }));
      console.log("📝 Revenue answer:", input);
    } else if (step === "data") {
      setAnswers((a) => ({ ...a, dataSources: input }));
      console.log("📝 Data sources answer:", input);
    } else if (step === "systems") {
      setAnswers((a) => ({ ...a, systems: input }));
      console.log("📝 Systems answer:", input);
    }
    // Confirm step is now handled by button click, not form submit

    if (step !== "confirm") {
      setTimeout(() => nextStep(), 600);
    }
  }

  const getPlaceholder = () => {
    switch (step) {
      case "intro":
        return "Click Next to start...";
      case "businessType":
        return "Select your business type...";
      case "employees":
        return "e.g., 5";
      case "goals":
        return "e.g., Grow revenue, improve cash flow";
      case "revenue":
        return "e.g., Subscription fees, product sales";
      case "data":
        return "e.g., Excel sheets, Google Analytics";
      case "systems":
        return "e.g., Salesforce, Stripe, NetSuite";
      default:
        return "Type your message...";
    }
  };

  const handleStartOver = () => {
    setStep("intro");
    setInput("");
    setSelectedBusinessType(null);
    setAnswers({});
    setMessages([
      {
        from: "milton",
        text: "Hi, I'm Milton 👋 — your AI finance copilot.",
      },
      {
        from: "milton",
        text: "I'll help you track your finances, understand your KPIs, and make data-driven decisions. Let's get started!",
      },
      {
        from: "milton",
        text: "Can I ask you a few quick questions to set up your workspace?",
      },
    ]);
  };

  const handleConfirm = () => {
    const businessTypeLabel = selectedBusinessType
      ? businessTypes.find((bt) => bt.id === selectedBusinessType)?.label
      : answers.industry || "Unknown";
    const businessDescription = `Business Type: ${businessTypeLabel}, Employees: ${answers.employees}, Goals: ${answers.goals}, Revenue: ${answers.revenue}, Data: ${answers.dataSources}, Systems: ${answers.systems}`;
    const next = {
      ...answers,
      businessDescription,
      businessType: selectedBusinessType || undefined,
      industry: businessTypeLabel,
    };
    setAnswers(next);
    finish(next);
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full relative">
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 pb-32">
        <Conversation className="flex-1 min-h-0 overflow-y-auto">
          <ConversationContent className="px-4 md:px-6 py-6 gap-3">
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<MessageSquare className="size-12" />}
                title="Start onboarding"
                description="Let's get started with a few quick questions"
              />
            ) : (
              messages.map((m, i) => (
                <Message
                  from={m.from === "milton" ? "assistant" : "user"}
                  key={i}
                  className="mb-3"
                >
                  <MessageContent>
                    <MessageResponse
                      from={m.from === "milton" ? "assistant" : "user"}
                      className="whitespace-pre-wrap"
                    >
                      {m.text}
                    </MessageResponse>
                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {step !== "done" && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-white p-4 md:p-6 z-50 shadow-lg">
          <div className="max-w-4xl mx-auto">
            {step === "intro" ? (
              <Button
                type="button"
                onClick={() => nextStep()}
                size="default"
                className="w-full min-h-[44px]"
              >
                Yes, let&apos;s start
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : step === "businessType" ? (
              <div className="space-y-4">
                <Select
                  value={selectedBusinessType || ""}
                  onValueChange={(value) => {
                    setSelectedBusinessType(value as BusinessTypeId);
                    const businessType = businessTypes.find(
                      (bt) => bt.id === value
                    );
                    if (businessType) {
                      setAnswers((a) => ({
                        ...a,
                        industry: businessType.label,
                      }));
                    }
                  }}
                >
                  <SelectTrigger className="w-full min-h-[44px]">
                    <SelectValue placeholder="Select your business type...">
                      {selectedBusinessType
                        ? businessTypes.find(
                            (bt) => bt.id === selectedBusinessType
                          )?.label
                        : "Select your business type..."}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {businessTypes.map((bt) => (
                      <SelectItem
                        key={bt.id}
                        value={bt.id}
                        textValue={bt.label}
                      >
                        <div>
                          <div className="font-medium">{bt.label}</div>
                          <div className="text-sm text-gray-500">
                            {bt.tagline}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={() => {
                    if (selectedBusinessType) {
                      nextStep();
                    }
                  }}
                  size="default"
                  className="w-full min-h-[44px]"
                  disabled={!selectedBusinessType}
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : step === "confirm" ? (
              <div className="flex gap-3">
                <Button
                  type="button"
                  onClick={handleConfirm}
                  size="default"
                  className="flex-1 min-h-[44px]"
                >
                  Confirm and send
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  onClick={handleStartOver}
                  size="default"
                  variant="outline"
                  className="flex-1 min-h-[44px]"
                >
                  Start over
                </Button>
              </div>
            ) : (
              <Input onSubmit={handleSubmit} className="w-full">
                <PromptInputTextarea
                  placeholder={getPlaceholder()}
                  value={input}
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
                  status="ready"
                  disabled={!input.trim()}
                  className="absolute bottom-1 right-1"
                />
              </Input>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
