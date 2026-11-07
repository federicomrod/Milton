// app/api/mobile/v1/ask/transcribe/route.ts
//
// POST (raw audio body, e.g. audio/m4a, up to ~1.5 MB: a spoken question):
// returns {text}. Same transcription call as the kitchen voice notes; the audio
// is never stored and never logged. Owner / admin / manager only.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { aiUnavailableFor, runTranscription } from "@/lib/ai/call";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const MAX_AUDIO_BYTES = 1_500_000;

export async function POST(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const d = getDictionary(auth.lang).kitchen.api;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) {
    return mobileJson({ error: d.managerVoiceTooBig }, 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return mobileJson({ error: d.managerVoiceFailed }, 400);
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return mobileJson({ error: d.managerVoiceTooBig }, 413);
  }
  const mime =
    request.headers.get("content-type")?.split(";")[0] || "audio/m4a";
  const file = new File([bytes], "question.m4a", { type: mime });
  const result = await runTranscription({
    feature: "ask-voice",
    companyId: auth.companyId,
    timeoutMs: 20000,
    params:
      auth.lang === "es"
        ? { file, model: "whisper-1", language: "es" }
        : { file, model: "whisper-1" },
  });
  if (!result.ok) {
    void aiUnavailableFor(result);
    return mobileJson({ error: d.managerVoiceFailed }, 502);
  }
  const text = (result.value.text ?? "").trim();
  if (!text) return mobileJson({ error: d.managerVoiceFailed }, 422);
  return mobileJson({ text });
}
