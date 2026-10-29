import { ImageResponse } from "next/og";

// The card shown when a VidMind link is shared (chat apps, the hackathon submission page).
export const alt = "VidMind: notes you can check against the video";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f5f5f7", padding: 72, gap: 56, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 28, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="64" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="8" fill="#0071e3" />
              <path d="M11 8.5 24 16H16z" fill="#fff" />
              <path d="M11 23.5 24 16H16z" fill="#fff" opacity="0.7" />
              <path d="M11 8.5 16 16l-5 7.5z" fill="#fff" opacity="0.88" />
            </svg>
            <div style={{ fontSize: 44, fontWeight: 600, color: "#1d1d1f" }}>VidMind</div>
          </div>
          <div style={{ fontSize: 72, fontWeight: 700, color: "#1d1d1f", lineHeight: 1.05, letterSpacing: -2 }}>
            Notes you can check against the video.
          </div>
          <div style={{ fontSize: 28, color: "#616166" }}>Every point links to the second it came from.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 420, padding: 28, background: "#ffffff", borderRadius: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.12)" }}>
          <div style={{ fontSize: 30, color: "#1d1d1f", lineHeight: 1.25 }}>The week-1 retention target is 40%.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ fontSize: 20, color: "#1f7a36", background: "rgba(36,138,61,0.1)", padding: "6px 14px", borderRadius: 999, display: "flex", alignItems: "center" }}>On screen at 0:30</div>
            <div style={{ fontSize: 20, color: "#0066cc", background: "rgba(0,113,227,0.09)", padding: "6px 14px", borderRadius: 999, display: "flex", alignItems: "center" }}>Never said aloud</div>
          </div>
          <div style={{ display: "flex" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#1f7a36", display: "flex" }}>
              ✓ Checked
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
