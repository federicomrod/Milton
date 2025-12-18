"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type MessageProps = ComponentProps<"div"> & {
  from: "user" | "assistant";
};

export const Message = ({
  className,
  from,
  children,
  ...props
}: MessageProps) => (
  <div
    className={cn(
      "flex gap-4",
      from === "user" ? "flex-row-reverse" : "flex-row",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageContentProps = ComponentProps<"div">;

export const MessageContent = ({
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn("flex flex-col gap-2 max-w-[80%]", className)}
    {...props}
  />
);

export type MessageResponseProps = ComponentProps<"div">;

export const MessageResponse = ({
  className,
  ...props
}: MessageResponseProps & { from?: "user" | "assistant" }) => {
  const from = (props as any).from;
  return (
    <div
      className={cn(
        "rounded-lg px-4 py-2 text-sm",
        from === "user"
          ? "bg-primary text-primary-foreground ml-auto"
          : "bg-muted text-muted-foreground",
        className
      )}
      {...props}
    />
  );
};
