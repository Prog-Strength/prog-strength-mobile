// Agent-service client. The agent owns LLM-shaped endpoints — /chat
// streams a response via SSE (called from lib/stream.ts), /title
// generates a friendly summary of a conversation for use as a
// chat-session title, and /speak returns mp3 bytes for the agent's
// reply when voice mode is on.
//
// Sibling file: prog-strength-web/lib/agent.ts. Same "edit twice"
// discipline as lib/api.ts — the title surface is identical between
// the two; the speech surface diverges because RN audio playback
// wants a file URI rather than a Blob.
import { File, Paths } from "expo-file-system";
import { config } from "@/lib/config";

/**
 * Shape of one message in the title payload. Same shape /chat takes.
 * Content is a plain string here — assistant tool-use blocks and
 * tool_results don't get sent because they aren't useful for
 * summarizing the conversation topic.
 */
export type TitleMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Ask the agent's /title endpoint for a 3–6 word summary. Always
 * returns a non-empty string ≤ 80 chars on success; throws on auth
 * failure or transport error. The agent itself has a server-side
 * fallback to a truncated first-user-message slice, so this client
 * doesn't need its own — but callers usually still wrap in a try/
 * catch and fall back locally because a 5xx / network blip
 * shouldn't block the user from getting *some* title.
 */
export async function generateChatTitle(
  token: string,
  messages: TitleMessage[],
): Promise<string> {
  const resp = await fetch(`${config.agentUrl}/title`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`agent /title returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  const body = (await resp.json()) as { title?: string };
  const title = (body?.title ?? "").trim();
  if (!title) throw new Error("agent /title returned an empty title");
  return title;
}

/**
 * Ask the agent's /speak endpoint for an mp3 of `text` spoken by
 * the configured TTS voice. Writes the audio to a temp file under
 * the app's cache directory and returns the file:// URI so callers
 * can hand it to expo-av's Audio.Sound.createAsync.
 *
 * Why a file (not a Blob like the web sibling): expo-av plays from
 * a URI; in RN there's no equivalent of URL.createObjectURL(blob).
 * The temp file lives in cacheDirectory so the OS reclaims it
 * eventually even if we forget to clean up — and the caller is
 * still expected to delete it explicitly after playback ends.
 *
 * Throws on 4xx / 5xx; callers that fire this best-effort after a
 * completed chat stream should wrap in try/catch and silently fall
 * back to text-only mode for that turn — voice is enhancement, not
 * core.
 */
export async function generateChatSpeech(
  token: string,
  text: string,
): Promise<string> {
  const resp = await fetch(`${config.agentUrl}/speak`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    // /speak returns plain-text errors; pull them so the caller can
    // decide whether to fall back, log, or surface to the user.
    const detail = await resp.text();
    throw new Error(`agent /speak returned ${resp.status}: ${detail.slice(0, 200)}`);
  }

  // expo-file-system 55+ uses the class-based File/Directory API
  // (Paths.cache + new File()), which accepts a Uint8Array directly
  // — no base64 round-trip needed. Filename is millisecond-stamped
  // so two concurrent /speak calls don't collide; the caller is
  // expected to delete after playback ends.
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const file = new File(Paths.cache, `chat-speak-${Date.now()}.mp3`);
  file.write(bytes);
  return file.uri;
}
