// GET /api/places/details?placeId=...&sessionToken=...
// Returns parsed address components for a selected Places prediction.
// Pairs with /api/places/autocomplete — same sessionToken = one billable session.

import { NextResponse } from "next/server";

interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId");
  const sessionToken = url.searchParams.get("sessionToken");

  if (!placeId) return NextResponse.json({ error: "placeId required" }, { status: 400 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Places API not configured" }, { status: 503 });

  const detailUrl = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${
    sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ""
  }`;

  const res = await fetch(detailUrl, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "formattedAddress,addressComponents",
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Places API error" }, { status: 502 });
  }

  const data = await res.json() as {
    formattedAddress?: string;
    addressComponents?: AddressComponent[];
  };

  const comps = data.addressComponents ?? [];
  const pick = (type: string) => comps.find((c) => c.types.includes(type));

  const streetNumber = pick("street_number")?.longText ?? "";
  const route = pick("route")?.longText ?? "";
  const line1 = [streetNumber, route].filter(Boolean).join(" ");
  const city =
    pick("locality")?.longText ??
    pick("sublocality_level_1")?.longText ??
    pick("administrative_area_level_3")?.longText ?? "";
  const state = pick("administrative_area_level_1")?.shortText ?? "";
  const zip = pick("postal_code")?.longText ?? "";

  return NextResponse.json({ line1, city, state, zip });
}
