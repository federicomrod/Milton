"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { getDataTablesForTemplate } from "@/lib/data-table-service";
import { type DataTable } from "@/lib/types/data";

const EMPLOYEE_RANGES = [
  { id: "1-5", label: "1-5 employees", value: "1-5" },
  { id: "6-10", label: "6-10 employees", value: "6-10" },
  { id: "11-25", label: "11-25 employees", value: "11-25" },
  { id: "26-50", label: "26-50 employees", value: "26-50" },
  { id: "51-100", label: "51-100 employees", value: "51-100" },
  { id: "100+", label: "100+ employees", value: "100+" },
];
import {
  saveOnboardingChat,
  archiveAndClearOnboardingChat,
  loadOnboardingChat,
  type OnboardingMessage,
} from "@/lib/onboarding-chat-service";

interface MiltonChatProps {
  onFinish: (answers: {
    industry: string;
    employees: string;
    goals: string;
    revenue: string;
    dataSources: string;
    systems: string;
    businessDescription: string;
    businessType?: string;
    selectedDataCategories?: Record<string, "yes" | "no" | "not_sure">;
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
    | "business_context"
    | "confirm"
    | "done"
  >("intro");
  const [input, setInput] = useState("");
  const [selectedBusinessType, setSelectedBusinessType] = useState<
    string | null
  >(null);
  const [businessTypes, setBusinessTypes] = useState<BusinessTypeDefinition[]>(
    []
  );
  const [selectedEmployeeRange, setSelectedEmployeeRange] = useState<
    string | null
  >(null);
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [selectedDataCategories, setSelectedDataCategories] = useState<
    Record<string, "yes" | "no" | "not_sure">
  >({});
  const [answers, setAnswers] = useState<{
    industry?: string;
    employees?: string;
    goals?: string;
    revenue?: string;
    dataSources?: string;
    systems?: string;
    businessContext?: string;
    businessDescription?: string;
    businessType?: string;
  }>({});
  const answersRef = useRef(answers);

  // Keep answersRef in sync with answers state
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  const hasFinishedRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const hasRestoredRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const initialMessages: OnboardingMessage[] = [
    {
      from: "milton",
      text: "Hi, I'm Milton 👋 — your AI finance copilot.",
    },
    {
      from: "milton",
      text: "I'll help you track your finances, understand your KPIs, and make data-driven decisions. We'll start by understanding your business, then set up your data sources, model your data, and select your KPIs. Let's get started!",
    },
    {
      from: "milton",
      text: "Can I ask you a few quick questions to set up your workspace?",
    },
  ];

  // Function to restore step and answers from messages
  const restoreStateFromMessages = useCallback(
    (msgs: OnboardingMessage[]) => {
      if (!msgs || msgs.length === 0) return;

      let restoredStep: typeof step = "intro";
      const restoredAnswers: typeof answers = {};
      let restoredBusinessType: string | null = null;

      // Check if we see "Yes, let's start" - means we're past intro
      const hasStarted = msgs.some(
        (m) => m.from === "user" && m.text.includes("Yes, let's start")
      );

      if (hasStarted) {
        // Default to businessType step if we've started
        restoredStep = "businessType";

        // Find business type selection
        const businessTypeQuestionIndex = msgs.findIndex(
          (m) =>
            m.from === "milton" &&
            m.text.includes("What type of business are you running")
        );
        if (businessTypeQuestionIndex !== -1) {
          const businessTypeResponse = msgs[businessTypeQuestionIndex + 1];
          if (businessTypeResponse && businessTypeResponse.from === "user") {
            const userBusinessType = businessTypeResponse.text;
            // Try to find matching business type
            const matchedType = businessTypes.find(
              (bt) => bt.label === userBusinessType
            );
            if (matchedType) {
              restoredBusinessType = matchedType.id;
              restoredAnswers.industry = matchedType.label;
              // If business type is answered, advance to employees
              restoredStep = "employees";
            }
          } else {
            // Question exists but no answer - stay at businessType
            restoredStep = "businessType";
          }
        }

        // Check for employees question
        const employeesQuestionIndex = msgs.findIndex(
          (m) => m.from === "milton" && m.text.includes("How many employees")
        );
        if (employeesQuestionIndex !== -1) {
          const employeesResponse = msgs[employeesQuestionIndex + 1];
          if (employeesResponse && employeesResponse.from === "user") {
            restoredAnswers.employees = employeesResponse.text;
            // If employees is answered, advance to goals
            restoredStep = "goals";
          } else {
            // Question exists but no answer - stay at employees
            restoredStep = "employees";
          }
        }

        // Check for goals question
        const goalsQuestionIndex = msgs.findIndex(
          (m) => m.from === "milton" && m.text.includes("main financial goals")
        );
        if (goalsQuestionIndex !== -1) {
          const goalsResponse = msgs[goalsQuestionIndex + 1];
          if (goalsResponse && goalsResponse.from === "user") {
            restoredAnswers.goals = goalsResponse.text;
            // If goals is answered, advance to revenue
            restoredStep = "revenue";
          } else {
            // Question exists but no answer - stay at goals
            restoredStep = "goals";
          }
        }

        // Check for revenue question
        const revenueQuestionIndex = msgs.findIndex(
          (m) =>
            m.from === "milton" &&
            m.text.includes("How does your company generate revenue")
        );
        if (revenueQuestionIndex !== -1) {
          const revenueResponse = msgs[revenueQuestionIndex + 1];
          if (revenueResponse && revenueResponse.from === "user") {
            restoredAnswers.revenue = revenueResponse.text;
            // If revenue is answered, advance to data
            restoredStep = "data";
          } else {
            // Question exists but no answer - stay at revenue
            restoredStep = "revenue";
          }
        }

        // Check for data sources question
        const dataQuestionIndex = msgs.findIndex(
          (m) =>
            m.from === "milton" &&
            m.text.includes("What kind of data do you already track")
        );
        if (dataQuestionIndex !== -1) {
          const dataResponse = msgs[dataQuestionIndex + 1];
          if (dataResponse && dataResponse.from === "user") {
            restoredAnswers.dataSources = dataResponse.text;
            // If data is answered, advance to systems
            restoredStep = "systems";
          } else {
            // Question exists but no answer - stay at data
            restoredStep = "data";
          }
        }

        // Check for systems question
        const systemsQuestionIndex = msgs.findIndex(
          (m) =>
            m.from === "milton" &&
            m.text.includes("Do you use any software systems")
        );
        if (systemsQuestionIndex !== -1) {
          const systemsResponse = msgs[systemsQuestionIndex + 1];
          if (systemsResponse && systemsResponse.from === "user") {
            restoredAnswers.systems = systemsResponse.text;
            // If systems is answered, advance to confirm
            restoredStep = "confirm";
          } else {
            // Question exists but no answer - stay at systems
            restoredStep = "systems";
          }
        }

        // Check if we're at confirm/done
        const hasSummary = msgs.some(
          (m) =>
            m.from === "milton" && m.text.includes("Here's what I've gathered")
        );
        if (hasSummary) {
          restoredStep = "confirm";
        }

        const isDone = msgs.some(
          (m) =>
            m.from === "milton" &&
            (m.text.includes("prepare your data model proposal") ||
              m.text.includes("Analyzing your business"))
        );
        if (isDone) {
          restoredStep = "done";
        }
      }

      // Apply restored state
      if (restoredBusinessType) {
        setSelectedBusinessType(restoredBusinessType);
      }
      if (Object.keys(restoredAnswers).length > 0) {
        setAnswers(restoredAnswers);
      }
      setStep(restoredStep);
    },
    [businessTypes]
  );

  // Ensure the question for the current step exists in messages after restoration
  useEffect(() => {
    if (!hasRestoredRef.current || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    const needsQuestion = () => {
      switch (step) {
        case "employees":
          return !messages.some(
            (m) => m.from === "milton" && m.text.includes("How many employees")
          );
        case "goals":
          return !messages.some(
            (m) =>
              m.from === "milton" && m.text.includes("main financial goals")
          );
        case "revenue":
          return !messages.some(
            (m) =>
              m.from === "milton" &&
              m.text.includes("How does your company generate revenue")
          );
        case "data":
          return !messages.some(
            (m) =>
              m.from === "milton" &&
              m.text.includes("What kind of data do you already track")
          );
        case "systems":
          return !messages.some(
            (m) =>
              m.from === "milton" &&
              m.text.includes("Do you use any software systems")
          );
        case "business_context":
          return !messages.some(
            (m) =>
              m.from === "milton" &&
              m.text.includes("Any additional context about your business")
          );
        default:
          return false;
      }
    };

    if (
      needsQuestion() &&
      lastMessage?.from === "user" &&
      step !== "intro" &&
      step !== "businessType" &&
      step !== "confirm" &&
      step !== "done"
    ) {
      // Add the missing question
      let questionText = "";
      switch (step) {
        case "employees": {
          const businessType = businessTypes.find(
            (bt) => bt.id === selectedBusinessType
          );
          questionText = `Perfect! I'll customize everything for ${businessType?.label || "your business"}. How many employees do you have?`;
          break;
        }
        case "goals":
          questionText =
            "Perfect. What are your main financial goals right now?";
          break;
        case "revenue":
          questionText = "How does your company generate revenue?";
          break;
        case "data":
          questionText =
            "What kind of data do you already track or have in files?";
          break;
        case "systems":
          questionText =
            "Do you use any software systems like a CRM, Stripe, or ERP?";
          break;
      }
      // Only add if the question text is set and the last message isn't already this question
      if (questionText && lastMessage?.text !== questionText) {
        setMessages((prev) => {
          // Double-check it's not already there to prevent duplicates
          const alreadyExists = prev.some(
            (m) => m.from === "milton" && m.text === questionText
          );
          if (alreadyExists) return prev;
          return [...prev, { from: "milton", text: questionText }];
        });
      }
    }
  }, [step, messages, businessTypes, selectedBusinessType, setMessages]);

  // Fetch business model templates from Supabase
  useEffect(() => {
    const loadBusinessTypes = async () => {
      const types = await getBusinessModelTemplates();
      setBusinessTypes(types);
    };
    loadBusinessTypes();
  }, []);

  // Load data tables when business type is selected
  useEffect(() => {
    const loadDataTables = async () => {
      if (selectedBusinessType) {
        const tables = await getDataTablesForTemplate(selectedBusinessType);
        setDataTables(tables);
        // Reset selected data categories when business type changes
        setSelectedDataCategories({});
      }
    };
    loadDataTables();
  }, [selectedBusinessType]);

  // Load existing chat on mount and restore state
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const loadExistingChat = async () => {
      const savedMessages = await loadOnboardingChat();
      if (savedMessages && savedMessages.length > 0) {
        setMessages(savedMessages);
        // Restore state after a brief delay to ensure businessTypes are loaded
        // We'll restore again when businessTypes are ready
      } else if (messages.length === 0) {
        setMessages(initialMessages);
      }
    };
    loadExistingChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore state from messages when both messages and businessTypes are available
  useEffect(() => {
    if (
      messages.length > 0 &&
      businessTypes.length > 0 &&
      hasLoadedRef.current &&
      !hasRestoredRef.current
    ) {
      // Only restore once
      hasRestoredRef.current = true;
      restoreStateFromMessages(messages);
    }
  }, [messages, businessTypes, restoreStateFromMessages]);

  // Auto-save messages when they change (debounced)
  const saveMessages = useCallback((msgs: OnboardingMessage[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      if (msgs.length > 0) {
        saveOnboardingChat(msgs);
      }
    }, 500);
  }, []);

  useEffect(() => {
    if (messages.length > 0 && hasLoadedRef.current) {
      saveMessages(messages);
    }
  }, [messages, saveMessages]);

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
      setStep("business_context");
      setMessages((prev) => [
        ...prev,
        {
          from: "milton",
          text: "Any additional context about your business? (Optional - you can skip this)",
        },
      ]);
    } else if (step === "business_context") {
      setStep("confirm");

      // Log all collected answers for debugging
      console.log("📋 Onboarding answers collected at systems step:", {
        businessType: selectedBusinessType,
        businessTypeLabel: businessTypes.find(
          (bt) => bt.id === selectedBusinessType
        )?.label,
        employees: answersRef.current.employees,
        goals: answersRef.current.goals,
        revenue: answersRef.current.revenue,
        dataSources: answersRef.current.dataSources,
        systems: answersRef.current.systems,
        allAnswers: answersRef.current,
      });

      // Build summary message
      const businessTypeLabel =
        businessTypes.find((bt) => bt.id === selectedBusinessType)?.label ||
        "Unknown";
      const summary = [
        `Business Type: ${businessTypeLabel}`,
        `Employees: ${answersRef.current.employees || "Not specified"}`,
        `Goals: ${answersRef.current.goals || "Not specified"}`,
        `Revenue Model: ${answersRef.current.revenue || "Not specified"}`,
        `Data Sources: ${answersRef.current.dataSources || "Not specified"}`,
        `Systems: ${answersRef.current.systems || "Not specified"}`,
        ...(answersRef.current.businessContext &&
        answersRef.current.businessContext !== "Not specified"
          ? [`Business Context: ${answersRef.current.businessContext}`]
          : []),
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
    businessType?: string;
    selectedDataCategories?: Record<string, "yes" | "no" | "not_sure">;
  }) {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;

    setStep("done");
    setMessages((prev) => [
      ...prev,
      {
        from: "milton",
        text: "Awesome! Let me process this and prepare your data model proposal.",
      },
      {
        from: "milton",
        text: "Please hold on while I prepare everything. Next, you'll declare which data sources you use, then we'll build your data model together.",
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
        businessType: nextAnswers.businessType, // Pass through businessType
        selectedDataCategories: nextAnswers.selectedDataCategories, // Pass through selectedDataCategories
      });
    } catch (err) {
      console.error("Error finishing onboarding:", err);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step !== "business_context" && !input.trim()) return;

    // For business context, use "Not specified" if empty
    const messageToSend =
      step === "business_context" && !input.trim() ? "Not specified" : input;

    sendUserMessage(messageToSend);

    if (step === "goals") {
      setAnswers((a) => ({ ...a, goals: input }));
    } else if (step === "revenue") {
      setAnswers((a) => ({ ...a, revenue: input }));
    } else if (step === "data") {
      setAnswers((a) => ({ ...a, dataSources: input }));
    } else if (step === "systems") {
      setAnswers((a) => ({ ...a, systems: input }));
    } else if (step === "business_context") {
      setAnswers((a) => ({ ...a, businessContext: input || "Not specified" }));
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
        return "Select employee range above...";
      case "goals":
        return "e.g., Grow revenue, improve cash flow";
      case "revenue":
        return "e.g., Subscription fees, product sales";
      case "data":
        return "Select data tables above...";
      case "systems":
        return "e.g., Salesforce, Stripe, NetSuite";
      case "business_context":
        return "e.g., We specialize in B2B SaaS for manufacturing companies...";
      default:
        return "Type your message...";
    }
  };

  const handleStartOver = async () => {
    // Archive current conversation before clearing
    await archiveAndClearOnboardingChat();

    setStep("intro");
    setInput("");
    setSelectedBusinessType(null);
    setSelectedEmployeeRange(null);
    setAnswers({});
    hasFinishedRef.current = false;
    hasRestoredRef.current = false;
    setMessages(initialMessages);
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
      selectedDataCategories, // Save the data categories selections
    };

    // Save data categories to localStorage for later use
    localStorage.setItem(
      "milton-selected-data-categories",
      JSON.stringify(selectedDataCategories)
    );

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
        <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card p-4 md:p-6 z-50 shadow-lg">
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
                    setSelectedBusinessType(value);
                    const businessType = businessTypes.find(
                      (bt) => bt.id === value
                    );
                    if (businessType) {
                      setAnswers((a) => ({
                        ...a,
                        industry: businessType.label,
                        businessType: value, // Set businessType with the ID
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
                        <div className="font-medium">{bt.label}</div>
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
            ) : step === "employees" ? (
              <div className="space-y-4">
                <Select
                  value={selectedEmployeeRange || ""}
                  onValueChange={(value) => {
                    setSelectedEmployeeRange(value);
                    const range = EMPLOYEE_RANGES.find((r) => r.id === value);
                    if (range) {
                      setAnswers((a) => ({
                        ...a,
                        employees: range.value,
                      }));
                    }
                  }}
                >
                  <SelectTrigger className="w-full min-h-[44px]">
                    <SelectValue placeholder="Select number of employees...">
                      {selectedEmployeeRange
                        ? EMPLOYEE_RANGES.find(
                            (r) => r.id === selectedEmployeeRange
                          )?.label
                        : "Select number of employees..."}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_RANGES.map((range) => (
                      <SelectItem
                        key={range.id}
                        value={range.id}
                        textValue={range.label}
                      >
                        <div className="font-medium">{range.label}</div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={() => {
                    if (selectedEmployeeRange) {
                      const range = EMPLOYEE_RANGES.find(
                        (r) => r.id === selectedEmployeeRange
                      );
                      const userResponse =
                        range?.label || selectedEmployeeRange;
                      setMessages((prev) => [
                        ...prev,
                        { from: "user", text: userResponse },
                      ]);
                      nextStep();
                    }
                  }}
                  size="default"
                  className="w-full min-h-[44px]"
                  disabled={!selectedEmployeeRange}
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : step === "data" ? (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground mb-4">
                  Select which data you currently track. You can select multiple
                  and change this later.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {dataTables.map((table) => (
                    <div
                      key={table.id}
                      className="flex items-center space-x-3 p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium">{table.name}</div>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            selectedDataCategories[table.id] === "yes"
                              ? "default"
                              : "outline"
                          }
                          onClick={() =>
                            setSelectedDataCategories((prev) => ({
                              ...prev,
                              [table.id]: "yes",
                            }))
                          }
                          className="text-xs px-3 py-1"
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            selectedDataCategories[table.id] === "no"
                              ? "default"
                              : "outline"
                          }
                          onClick={() =>
                            setSelectedDataCategories((prev) => ({
                              ...prev,
                              [table.id]: "no",
                            }))
                          }
                          className="text-xs px-3 py-1"
                        >
                          No
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            selectedDataCategories[table.id] === "not_sure"
                              ? "default"
                              : "outline"
                          }
                          onClick={() =>
                            setSelectedDataCategories((prev) => ({
                              ...prev,
                              [table.id]: "not_sure",
                            }))
                          }
                          className="text-xs px-3 py-1"
                        >
                          Not Sure
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  onClick={() => {
                    // Convert selected tables to a string for the answers
                    const selectedTablesText = Object.entries(
                      selectedDataCategories
                    )
                      .filter(([, status]) => status === "yes")
                      .map(
                        ([id]) =>
                          dataTables.find((table) => table.id === id)?.name
                      )
                      .filter(Boolean)
                      .join(", ");
                    setAnswers((a) => ({
                      ...a,
                      dataSources:
                        selectedTablesText || "No data tables selected",
                    }));

                    // Add user response to chat
                    const userResponse =
                      selectedTablesText || "No specific data tables selected";
                    setMessages((prev) => [
                      ...prev,
                      { from: "user", text: userResponse },
                    ]);

                    nextStep();
                  }}
                  size="default"
                  className="w-full min-h-[44px]"
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
                      if (step === "business_context" || input.trim()) {
                        handleSubmit(e);
                      }
                    }
                  }}
                />
                <PromptInputSubmit
                  status="ready"
                  disabled={step === "business_context" ? false : !input.trim()}
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
