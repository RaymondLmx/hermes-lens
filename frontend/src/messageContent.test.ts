import { describe, expect, it } from "vitest";

import { messageContent } from "./messageContent";
import type { MonitorEvent } from "./types";

function userEvent(payload: Record<string, unknown>): MonitorEvent {
  return {
    schema_version: 1,
    session_id: "session-1",
    turn_id: "turn-1",
    seq: 1,
    ts: "2026-06-24T10:00:00+08:00",
    source: "hermes",
    type: "user.message",
    importance: "primary",
    group_id: null,
    payload,
  };
}

describe("messageContent", () => {
  it("separates structured user text and image input", () => {
    const content = messageContent(
      userEvent({
        text: [
          {
            type: "text",
            text: JSON.stringify({ user_text: "what is in this image?" }),
          },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,YQ==" },
          },
        ],
      }),
    );

    expect(content.text).toBe("what is in this image?");
    expect(content.media).toEqual([
      {
        alt: "Message image",
        src: "data:image/png;base64,YQ==",
      },
    ]);
  });

  it("uses the controlled media endpoint for local references", () => {
    const content = messageContent(
      userEvent({
        text: "inspect",
        media: [{ path: "/home/test/.hermes/live-media/frame.jpg" }],
      }),
    );

    expect(content.media[0].src).toContain("/api/media?path=");
  });

  it("marks truncated or remote untrusted image sources as unavailable", () => {
    const content = messageContent(
      userEvent({
        media: [
          { url: "data:image/jpeg;base64,abc [truncated 20 chars]" },
          { url: "https://example.com/private.png" },
        ],
      }),
    );

    expect(content.media).toEqual([
      {
        alt: "Message image",
        unavailableReason: "Image data was truncated during capture",
      },
      {
        alt: "Message image",
        unavailableReason: "Remote image source is hidden",
      },
    ]);
  });
});
