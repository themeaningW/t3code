import type { PreviewAnnotationPayload } from "@t3tools/contracts";

import { dataUrlToFile } from "./imageCompression";
import { randomUUID } from "./utils";

export type PreviewAnnotationCapture =
  | { readonly status: "captured"; readonly file: File }
  | { readonly status: "none" }
  | { readonly status: "failed" };

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export function assignPreviewAnnotationId(
  annotation: PreviewAnnotationPayload,
): PreviewAnnotationPayload {
  // Picker counters restart on navigation; upload identities must remain unique across pages and tabs.
  return { ...annotation, id: `annotation_${randomUUID()}` };
}

/** Decode Electron's PNG crop locally; fetching a data URL violates desktop connect-src. */
export function capturePreviewAnnotationScreenshot(
  annotation: PreviewAnnotationPayload,
): PreviewAnnotationCapture {
  if (!annotation.screenshot) return { status: "none" };
  try {
    const { dataUrl } = annotation.screenshot;
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      return { status: "failed" };
    }
    const file = dataUrlToFile(dataUrl, `preview-annotation-${annotation.id}.png`, "image/png");
    return file.size > 0 ? { status: "captured", file } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
