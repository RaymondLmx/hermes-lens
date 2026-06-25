import { mediaUrl } from "./api";
import type { MonitorEvent } from "./types";

export interface MessageMedia {
  alt: string;
  height?: number;
  mime?: string;
  src?: string;
  unavailableReason?: string;
  width?: number;
}

export interface MessageContent {
  media: MessageMedia[];
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readableText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return value;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed) && typeof parsed.user_text === "string") {
      return parsed.user_text;
    }
  } catch {
    return value;
  }
  return value;
}

function imageSource(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  for (const key of ["url", "path", "src"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return null;
}

function renderableSource(
  source: string,
): { src: string } | { unavailableReason: string } | null {
  if (source.startsWith("data:image/")) {
    return source.includes("[truncated")
      ? { unavailableReason: "Image data was truncated during capture" }
      : { src: source };
  }
  if (source.startsWith("/")) return { src: mediaUrl(source) };
  if (/^https?:\/\//i.test(source)) {
    return { unavailableReason: "Remote image source is hidden" };
  }
  return null;
}

export function messageContent(event: MonitorEvent): MessageContent {
  const media: MessageMedia[] = [];
  const text: string[] = [];

  const addMedia = (source: unknown, alt = "Message image") => {
    const raw = imageSource(source);
    if (!raw) return;
    const rendered = renderableSource(raw);
    if (!rendered) return;
    const metadata = isRecord(source) ? source : null;
    media.push({
      alt,
      ...rendered,
      height:
        metadata && typeof metadata.height === "number"
          ? metadata.height
          : undefined,
      mime:
        metadata && typeof metadata.mime === "string"
          ? metadata.mime
          : undefined,
      width:
        metadata && typeof metadata.width === "number"
          ? metadata.width
          : undefined,
    });
  };

  const consume = (value: unknown) => {
    if (typeof value === "string") {
      text.push(readableText(value));
      return;
    }
    if (!Array.isArray(value)) return;
    for (const part of value) {
      if (typeof part === "string") {
        text.push(readableText(part));
        continue;
      }
      if (!isRecord(part)) continue;
      const type = typeof part.type === "string" ? part.type : "";
      if (type === "text" && typeof part.text === "string") {
        text.push(readableText(part.text));
      } else if (type === "image_url") {
        addMedia(part.image_url);
      } else if (type === "image" || type === "media") {
        addMedia(part);
      }
    }
  };

  consume(event.payload.text);
  if (text.length === 0) consume(event.payload.content);

  const payloadMedia = event.payload.media;
  if (Array.isArray(payloadMedia)) {
    for (const item of payloadMedia) {
      const alt =
        isRecord(item) && typeof item.caption === "string"
          ? item.caption
          : "Message image";
      addMedia(item, alt);
    }
  }

  if (event.type === "vision.frame") {
    addMedia(
      event.payload,
      typeof event.payload.caption === "string"
        ? event.payload.caption
        : "Vision frame",
    );
  }

  return { media, text: text.filter(Boolean).join("\n") };
}
