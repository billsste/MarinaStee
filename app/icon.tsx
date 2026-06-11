import { ImageResponse } from "next/og";

// App icon (maskable, used by Android/PWA installs). Generated from the
// brand mark on every request — tweak the gradient/letter here, no PNG export.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Nantucket — Soft Navy → Hydrangea → Cloud sweep gives the
          // launcher icon a coastal sky feel that matches the in-app
          // palette. Edges fall to Cloud so the maskable crop never
          // shows a hard band on Android's adaptive-icon framing.
          background:
            "linear-gradient(135deg, #3C4E63 0%, #7E9BB8 60%, #D5D7D2 100%)",
          color: "#FBFBF8",
          fontSize: 320,
          fontWeight: 700,
          fontFamily: "system-ui, -apple-system, sans-serif",
          letterSpacing: "-0.05em",
        }}
      >
        M
      </div>
    ),
    { ...size }
  );
}
