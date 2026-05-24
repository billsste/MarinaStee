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
          background:
            "linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)",
          color: "white",
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
