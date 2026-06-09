// POST /api/places/autocomplete
// Proxies Google Places API (New) address autocomplete for the boater
// onboarding wizard. Returns US address suggestions as the user types.
// Gracefully returns empty predictions when GOOGLE_PLACES_API_KEY is not set
// so the form still works — just without suggestions.

import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";

  if (input.length < 2) {
    return NextResponse.json({ predictions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    // Not configured — return empty so the form degrades gracefully.
    return NextResponse.json({ predictions: [] });
  }

  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify({
      input,
      sessionToken: sessionToken || undefined,
      // Restrict to US residential + postal addresses
      includedPrimaryTypes: ["street_address", "route", "subpremise"],
      regionCode: "us",
      languageCode: "en",
    }),
  });

  if (!res.ok) {
    // Fallback: retry with broader type filter
    const retry = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
      body: JSON.stringify({
        input,
        sessionToken: sessionToken || undefined,
        includedPrimaryTypes: ["geocode"],
        regionCode: "us",
        languageCode: "en",
      }),
    });
    if (!retry.ok) return NextResponse.json({ predictions: [] });
    const data = await retry.json() as { suggestions?: Suggestion[] };
    return NextResponse.json({ predictions: shapePredictions(data.suggestions ?? []) });
  }

  const data = await res.json() as { suggestions?: Suggestion[] };
  return NextResponse.json({ predictions: shapePredictions(data.suggestions ?? []) });
}

interface Suggestion {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
}

function shapePredictions(suggestions: Suggestion[]) {
  return suggestions
    .map((s) => {
      const p = s.placePrediction;
      if (!p?.placeId) return null;
      return {
        placeId: p.placeId,
        // Full address string shown in the dropdown
        description: p.text?.text ?? "",
        // Street part (main) and city/state part (secondary)
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
      };
    })
    .filter(Boolean);
}
