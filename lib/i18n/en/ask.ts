import type { Dictionary } from "../types";

export const ask: Dictionary["ask"] = {
  page: { title: "Ask Milton" },
  api: {
    invalidJson: "The request body is not valid JSON.",
    messageRequired: "Write a question.",
    messageTooLong: "The question is too long (maximum {max} characters).",
    contextFailed: "Could not prepare Milton's context.",
  },
};
