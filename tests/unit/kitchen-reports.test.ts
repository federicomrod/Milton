import { describe, it, expect } from "vitest";
import {
  classifyKitchenReport,
  extractReportFromMessage,
} from "@/lib/restaurant/telegram/kitchen-reports";

describe("classifyKitchenReport", () => {
  it.each([
    ["86 tiramisú", "86"],
    ["Se acabó el salmón", "86"],
    ["no hay limones", "86"],
    ["Merma: 2 kg arroz, se quemó", "waste"],
    ["Tiramos 1 kilo de pollo, se pasó la fecha", "waste"],
    ["quedan para 3 platos", "running_out"],
    ["se está acabando la crema", "running_out"],
    ["casi no queda aguacate", "running_out"],
    ["quedan pocos, últimos 2 kilos", "running_out"],
    ["sin limón", "86"],
    ["hola buenas", "unclassified"],
    ["", "unclassified"],
  ])("%s -> %s", (text, expected) => {
    expect(classifyKitchenReport(text)).toBe(expected);
  });

  it("empty or missing text is unclassified", () => {
    expect(classifyKitchenReport(null)).toBe("unclassified");
    expect(classifyKitchenReport(undefined)).toBe("unclassified");
    expect(classifyKitchenReport("   ")).toBe("unclassified");
  });

  it("waste wins over 86 in a mixed message", () => {
    expect(classifyKitchenReport("86 salmón, merma de 2 kilos")).toBe("waste");
  });

  it("matches without accents too", () => {
    expect(classifyKitchenReport("se acabo el pollo")).toBe("86");
  });

  it("'tiramisú' alone is not waste", () => {
    expect(classifyKitchenReport("tiramisú listo")).toBe("unclassified");
  });
});

describe("extractReportFromMessage", () => {
  it("plain text", () => {
    expect(
      extractReportFromMessage({ message_id: 7, text: " 86 tiramisú " })
    ).toMatchObject({
      report_type: "86",
      text: "86 tiramisú",
      media_kind: null,
      telegram_message_id: 7,
    });
  });

  it("picks the largest photo and uses the caption", () => {
    const r = extractReportFromMessage({
      message_id: 8,
      caption: "merma 10 panes",
      photo: [
        {
          file_id: "small",
          file_unique_id: "us",
          file_size: 1000,
          width: 90,
          height: 60,
        },
        {
          file_id: "big",
          file_unique_id: "ub",
          file_size: 90000,
          width: 1280,
          height: 960,
        },
        {
          file_id: "mid",
          file_unique_id: "um",
          file_size: 20000,
          width: 320,
          height: 240,
        },
      ],
    });
    expect(r).toMatchObject({
      report_type: "waste",
      text: "merma 10 panes",
      media_kind: "photo",
      telegram_file_id: "big",
      telegram_file_unique_id: "ub",
      media_size_bytes: 90000,
      media_mime: "image/jpeg",
    });
  });

  it("maps voice fields; no caption is unclassified", () => {
    expect(
      extractReportFromMessage({
        message_id: 9,
        voice: {
          file_id: "v1",
          file_unique_id: "uv1",
          duration: 12,
          mime_type: "audio/ogg",
          file_size: 4321,
        },
      })
    ).toMatchObject({
      report_type: "unclassified",
      text: null,
      media_kind: "voice",
      telegram_file_id: "v1",
      telegram_file_unique_id: "uv1",
      media_duration_s: 12,
      media_mime: "audio/ogg",
      media_size_bytes: 4321,
    });
  });

  it("classifies a voice caption", () => {
    expect(
      extractReportFromMessage({
        message_id: 10,
        caption: "se acabó el arroz",
        voice: { file_id: "v" },
      })?.report_type
    ).toBe("86");
  });

  it("ignores unsupported or empty updates", () => {
    expect(extractReportFromMessage({ message_id: 1 })).toBeNull();
    expect(extractReportFromMessage({ message_id: 1, text: "   " })).toBeNull();
    expect(extractReportFromMessage({ text: "hola" })).toBeNull();
  });

  it("caps text at 2000 characters", () => {
    const r = extractReportFromMessage({
      message_id: 1,
      text: "a".repeat(5000),
    });
    expect(r?.text).toHaveLength(2000);
  });
});
