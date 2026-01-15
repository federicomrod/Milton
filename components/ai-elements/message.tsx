"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

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

export type MessageResponseProps = ComponentProps<"div"> & {
  from?: "user" | "assistant";
};

export const MessageResponse = ({
  className,
  from,
  children,
  ...props
}: MessageResponseProps) => {
  const isAssistant = from === "assistant";
  const content = children;

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
    >
      {isAssistant && typeof content === "string" ? (
        <div className="markdown-content">
          <ReactMarkdown
            components={
              {
                p: ({ children }: { children: ReactNode }) => (
                  <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
                ),
                ul: ({ children }: { children: ReactNode }) => (
                  <ul className="list-disc list-inside mb-2 space-y-1.5 ml-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }: { children: ReactNode }) => (
                  <ol className="list-decimal list-inside mb-2 space-y-1.5 ml-1">
                    {children}
                  </ol>
                ),
                li: ({ children }: { children: ReactNode }) => (
                  <li className="leading-relaxed">{children}</li>
                ),
                strong: ({ children }: { children: ReactNode }) => (
                  <strong className="font-semibold">{children}</strong>
                ),
                em: ({ children }: { children: ReactNode }) => (
                  <em className="italic">{children}</em>
                ),
                h1: ({ children }: { children: ReactNode }) => (
                  <h1 className="text-base font-semibold mb-2 mt-3 first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }: { children: ReactNode }) => (
                  <h2 className="text-sm font-semibold mb-2 mt-3 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }: { children: ReactNode }) => (
                  <h3 className="text-sm font-medium mb-1 mt-2 first:mt-0">
                    {children}
                  </h3>
                ),
                code: ({ children }: { children: ReactNode }) => (
                  <code className="bg-background/50 px-1.5 py-0.5 rounded text-xs font-mono">
                    {children}
                  </code>
                ),
                blockquote: ({ children }: { children: ReactNode }) => (
                  <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic my-2 text-muted-foreground">
                    {children}
                  </blockquote>
                ),
              } as Components
            }
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        content
      )}
    </div>
  );
};
