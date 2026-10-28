import { ImageResponse } from "next/og";

// The card shown when a VidMind link is shared (chat apps, the hackathon submission page).
export const alt = "VidMind: notes you can check against the video";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "linear-gradient(135deg, #04050d 0%, #120d33 60%, #2a0b2a 100%)", padding: 72, gap: 56, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 28, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="64" height="64" viewBox="0 0 32 32">
              <path d="M2 16h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <path d="M9 5 27 16H15.5z" fill="#6fd8ff" />
              <path d="M9 27 27 16H15.5z" fill="#c45cff" />
              <path d="M9 5 15.5 16 9 27z" fill="#fff" />
            </svg>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#eceeff" }}>VidMind</div>
          </div>
          <div style={{ fontSize: 68, fontWeight: 700, color: "#eceeff", lineHeight: 1.05, letterSpacing: -1 }}>
            Notes you can check against the video.
          </div>
          <div style={{ fontSize: 28, color: "#9aa0c3" }}>Every point links to the second it came from.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 420, padding: 28, background: "rgba(255,255,255,0.06)", borderRadius: 16, border: "1px solid rgba(160,166,220,0.25)" }}>
          <div style={{ fontSize: 30, color: "#eceeff", lineHeight: 1.25 }}>The week-1 retention target is 40%.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ fontSize: 20, color: "#34d399", background: "rgba(52,211,153,0.14)", padding: "6px 14px", borderRadius: 999, display: "flex", alignItems: "center" }}>On screen at 0:30</div>
            <div style={{ fontSize: 20, color: "#b1a7ff", background: "rgba(139,123,255,0.16)", padding: "6px 14px", borderRadius: 999, display: "flex", alignItems: "center" }}>Never said aloud</div>
          </div>
          <div style={{ display: "flex" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#34d399", border: "3px solid #34d399", borderRadius: 10, padding: "2px 16px", transform: "rotate(-4deg)" }}>
              Checked
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
