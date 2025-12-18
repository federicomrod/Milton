"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, Send } from "lucide-react";
import type { ComponentProps } from "react";
import { forwardRef } from "react";

export type InputProps = ComponentProps<"form">;

export const Input = ({
  className,
  onSubmit,
  children,
  ...props
}: InputProps) => {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit?.(e);
  };

  return (
    <form
      className={cn("relative flex items-end gap-2", className)}
      onSubmit={handleSubmit}
      {...props}
    >
      {children}
    </form>
  );
};

export type PromptInputTextareaProps = ComponentProps<"textarea">;

export const PromptInputTextarea = forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[44px] w-full resize-none rounded-md border border-input bg-background px-4 py-3 text-sm",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    rows={1}
    {...props}
  />
));
PromptInputTextarea.displayName = "PromptInputTextarea";

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: "ready" | "streaming";
};

export const PromptInputSubmit = ({
  className,
  status = "ready",
  disabled,
  ...props
}: PromptInputSubmitProps) => (
  <Button
    type="submit"
    size="icon"
    disabled={disabled || status === "streaming"}
    className={cn("shrink-0", className)}
    {...props}
  >
    {status === "streaming" ? (
      <Loader2 className="size-4 animate-spin" />
    ) : (
      <Send className="size-4" />
    )}
  </Button>
);
