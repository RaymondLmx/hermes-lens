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

const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;
const MEDIA_HINT_KEYS = [
  "image",
  "image_path",
  "image_url",
  "images",
  "media",
  "media_path",
  "media_url",
  "screenshot",
  "screenshot_path",
  "thumbnail",
  "thumbnail_path",
  "url",
  "path",
  "src",
];

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
  for (const key of ["url", "path", "src", "file", "filepath", "image_path"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return null;
}

function parseJsonLike(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function renderableSource(
  source: string,
): { src: string } | { unavailableReason: string } | null {
  const normalizedSource = source.startsWith("file://")
    ? decodeURIComponent(source.slice("file://".length))
    : source;
  if (source.startsWith("data:image/")) {
    return source.includes("[truncated")
      ? { unavailableReason: "Image data was truncated during capture" }
      : { src: source };
  }
  if (normalizedSource.startsWith("/")) return { src: mediaUrl(normalizedSource) };
  if (/^https?:\/\//i.test(normalizedSource)) {
    return { unavailableReason: "Remote image source is hidden" };
  }
  return null;
}

export function messageContent(event: MonitorEvent): MessageContent {
  const media: MessageMedia[] = [];
  const seenMedia = new Set<string>();
  const text: string[] = [];

  const addMedia = (source: unknown, alt = "Message image") => {
    const raw = imageSource(source);
    if (!raw) return;
    const rendered = renderableSource(raw);
    if (!rendered) return;
    const key = "src" in rendered ? rendered.src : `${raw}:${rendered.unavailableReason}`;
    if (seenMedia.has(key)) return;
    seenMedia.add(key);
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

  const scanForMedia = (
    value: unknown,
    alt = "Message image",
    depth = 0,
    hinted = false,
  ) => {
    if (depth > 7 || value == null) return;

    if (typeof value === "string") {
      const parsed = parseJsonLike(value);
      if (parsed !== null) {
        scanForMedia(parsed, alt, depth + 1, hinted);
        return;
      }
      if (
        value.startsWith("data:image/") ||
        value.startsWith("file://") ||
        (value.startsWith("/") && IMAGE_EXTENSIONS.test(value))
      ) {
        addMedia(value, alt);
      } else if (hinted && (value.startsWith("/") || /^https?:\/\//i.test(value))) {
        addMedia(value, alt);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) scanForMedia(item, alt, depth + 1, hinted);
      return;
    }

    if (!isRecord(value)) return;

    const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
    const mime = typeof value.mime === "string" ? value.mime : "";
    const caption =
      typeof value.caption === "string"
        ? value.caption
        : typeof value.alt === "string"
          ? value.alt
          : alt;
    const objectLooksLikeMedia =
      type.includes("image") ||
      type.includes("media") ||
      mime.startsWith("image/") ||
      MEDIA_HINT_KEYS.some((key) => key in value);

    if (objectLooksLikeMedia) addMedia(value, caption);
    if (isRecord(value.image_url)) addMedia(value.image_url, caption);

    for (const [key, child] of Object.entries(value)) {
      const childHinted =
        hinted ||
        MEDIA_HINT_KEYS.some((hint) => key.toLowerCase().includes(hint));
      scanForMedia(child, caption, depth + 1, childHinted);
    }
  };

  const consume = (value: unknown) => {
    if (typeof value === "string") {
      text.push(readableText(value));
      scanForMedia(value);
      return;
    }
    if (!Array.isArray(value)) return;
    for (const part of value) {
      if (typeof part === "string") {
        text.push(readableText(part));
        scanForMedia(part);
        continue;
      }
      if (!isRecord(part)) continue;
      const type = typeof part.type === "string" ? part.type : "";
      if (type === "text" && typeof part.text === "string") {
        text.push(readableText(part.text));
        scanForMedia(part.text);
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

  scanForMedia(event.payload);

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
