import { ImageResponse } from "next/og";

// Apple touch icon — used by iOS when added to home screen.
// iOS doesn't honor `maskable`, so we draw with proper rounded corners ourselves.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)",
          color: "white",
          fontSize: 112,
          fontWeight: 700,
          fontFamily: "system-ui, -apple-system, sans-serif",
          letterSpacing: "-0.05em",
          borderRadius: 40,
        }}
      >
        M
      </div>
    ),
    { ...size }
  );
}
