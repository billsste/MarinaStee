/*
 * POST /api/comms/send — dispatch an outbound email or SMS through
 * the configured provider (Postmark / Twilio). Returns the result so
 * the caller can update the local Communication row's status.
 *
 * Body shape (JSON):
 *   {
 *     channel: "email" | "sms",
 *     to: string,             // email address or E.164 phone
 *     subject?: string,       // email only
 *     body: string,
 *     from?: string           // optional override; defaults to env / marina profile
 *   }
 *
 * Response shape:
 *   {
 *     status: "delivered" | "queued" | "failed",
 *     provider: "postmark" | "twilio" | "stub",
 *     provider_id?: string,
 *     error?: string
 *   }
 *
 * Auth: today this route is open — when Convex + Clerk land, it'll
 * verify the requester's JWT and rate-limit per tenant via the
 * convex/rateLimit.ts checker.
 */

import { NextRequest, NextResponse } from "next/server";
import { dispatchOutbound } from "@/lib/outbound";

export const runtime = "nodejs";

interface SendBody {
  channel?: "email" | "sms";
  to?: string;
  subject?: string;
  body?: string;
  from?: string;
}

export async function POST(req: NextRequest) {
  let body: SendBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { status: "failed", error: "invalid_json" },
      { status: 400 },
    );
  }

  const channel = body.channel;
  const to = body.to?.trim();
  const text = body.body?.trim();
  if (
    (channel !== "email" && channel !== "sms") ||
    !to ||
    !text
  ) {
    return NextResponse.json(
      { status: "failed", error: "missing_fields" },
      { status: 400 },
    );
  }

  const result = await dispatchOutbound({
    channel,
    to,
    subject: body.subject,
    body: text,
    from: body.from,
  });

  return NextResponse.json(result, {
    status: result.status === "failed" ? 502 : 200,
  });
}
