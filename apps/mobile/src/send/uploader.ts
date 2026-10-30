// PUTs a local file straight to Supabase Storage with the signed upload URL
// the API handed out. The file streams from disk (never loaded into memory)
// and never goes through our server. The URL is never logged.

import { File, UploadType } from "expo-file-system";
import { ApiError } from "../api/client";
import type { Uploader } from "./outbox-core";

export const uploadToSignedUrl: Uploader = async ({ url, fileUri, mime }) => {
  try {
    const task = new File(fileUri).createUploadTask(url, {
      httpMethod: "PUT",
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: mime,
      sessionType: "foreground",
      headers: {
        "Content-Type": mime,
        "Cache-Control": "max-age=3600",
        "x-upsert": "true",
      },
    });
    const result = await task.uploadAsync();
    return { status: result.status };
  } catch {
    // Could not reach Storage (no connection, file gone…): retry later.
    throw new ApiError("network");
  }
};
