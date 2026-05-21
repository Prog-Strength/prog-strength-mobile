/**
 * Tiny SSE parser for streaming chat responses from the agent.
 *
 * The agent's /chat endpoint emits server-sent events as `data: <json>`
 * lines separated by blank lines. We can't use the built-in EventSource
 * because it doesn't let us set the Authorization header — and we need
 * to send the user's JWT. Same pattern as prog-strength-web's
 * lib/stream.ts.
 *
 * Why `expo/fetch` instead of React Native's built-in fetch: built-in
 * fetch on RN exposes a `Response.body` that doesn't reliably stream
 * (some platforms buffer the whole response before resolving). The
 * Expo team's `fetch` polyfill ships a spec-compliant ReadableStream
 * that yields bytes as they arrive — exactly what an SSE consumer
 * needs. If that import breaks in a future SDK, swap to the
 * `react-native-sse` library and rewrite this file as a small EventSource
 * wrapper; the StreamEvent type would stay identical.
 */
import { fetch as expoFetch } from "expo/fetch";
import { config } from "@/lib/config";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; name: string }
  | { type: "tool_result"; name: string; is_error: boolean }
  // Emitted once at the start of each assistant turn so the UI can
  // label which model produced the response (Haiku for simple CRUD,
  // Sonnet for analysis). See ModelRouter on the agent side.
  | { type: "model_chosen"; model: string }
  | { type: "done"; stop_reason: string }
  | { type: "error"; message: string };

/**
 * POST `body` to the agent's /chat and yield StreamEvents as they
 * arrive. Caller drives the loop with `for await`.
 *
 * The agent decides when the response is finished and emits a `done`
 * event; we don't enforce a timeout here. Network errors propagate as
 * thrown errors from the async generator.
 */
export async function* streamChat(
  token: string,
  body: unknown,
): AsyncGenerator<StreamEvent> {
  const resp = await expoFetch(`${config.agentUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    let detail = `HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      detail = errBody?.error ?? detail;
    } catch {
      // Swallow JSON parse errors — leave detail as the status code.
    }
    throw new Error(detail);
  }
  yield* parseSSE(resp.body);
}

/**
 * Parse a ReadableStream of SSE bytes and yield each event as it
 * arrives. Spec-compliant SSE separates events by `\n\n`; we buffer
 * between reads so an event boundary that lands mid-chunk doesn't drop
 * the event.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Peel off complete events; whatever's left in `buffer` after
      // the last `\n\n` may be a partial event waiting on bytes from
      // the next read.
      let separatorIdx;
      while ((separatorIdx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        const ev = parseEvent(rawEvent);
        if (ev) yield ev;
      }
    }
    // Drain anything trailing without a final \n\n. Most servers send
    // one, but we shouldn't lose the last event if they don't.
    if (buffer.trim().length > 0) {
      const ev = parseEvent(buffer);
      if (ev) yield ev;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(raw: string): StreamEvent | null {
  // The agent only emits single-line `data:` events. Multi-line `data:`
  // is legal SSE but unused here — strip the prefix and JSON.parse.
  for (const line of raw.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6)) as StreamEvent;
      } catch {
        return null;
      }
    }
  }
  return null;
}
