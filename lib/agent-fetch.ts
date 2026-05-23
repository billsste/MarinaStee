"use client";

/*
 * Client-side wrapper that prefers the real /api/agent stream when available,
 * and falls back to the deterministic simulated agent otherwise.
 *
 * Returns chunks via an async iterable. Action detection runs on the simulated
 * layer regardless of which model produced the text.
 */

import {
  generateAgentResponse,
  type AgentAction,
} from "@/lib/simulated-agent";
import type { LedgerEntry } from "@/lib/types";

export type AgentStreamResult = {
  /** async iterable producing text chunks */
  text: AsyncIterable<string>;
  /** populated once the stream completes; null if no action proposed */
  actionPromise: Promise<AgentAction | undefined>;
  /** true if served by the real API, false if simulated */
  source: "claude" | "simulated";
};

export async function startAgentStream(
  prompt: string,
  ledger: LedgerEntry[]
): Promise<AgentStreamResult> {
  // Always compute the local fallback up front — gives us deterministic action
  // detection from the prompt regardless of which model narrates.
  const fallback = generateAgentResponse(prompt, ledger);

  // Try the real API first
  let res: Response | null = null;
  try {
    res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  } catch {
    res = null;
  }

  if (!res || !res.ok || !res.body) {
    return {
      text: simulatedAsyncIterable(fallback.stream),
      actionPromise: Promise.resolve(fallback.action),
      source: "simulated",
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  return {
    text: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield decoder.decode(value, { stream: true });
        }
      },
    },
    actionPromise: Promise.resolve(fallback.action),
    source: "claude",
  };
}

async function* simulatedAsyncIterable(chunks: string[]) {
  // Initial "thinking" pause to match the perceived latency of the real API
  await delay(350);
  for (const chunk of chunks) {
    yield chunk;
    await delay(Math.min(60 + chunk.length * 8, 300));
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
