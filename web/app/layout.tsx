import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Ambient from "@/components/Ambient";
import "./globals.css";

// A geometric display face for headlines, a neutral sans for reading, a mono for agent logs and data.
const display = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"] });
const sans = Geist({ variable: "--font-geist", subsets: ["latin"] });

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Share previews need absolute image URLs: set NEXT_PUBLIC_SITE_URL to the deployed address.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "VidMind",
  description: "Notes from any video, with the exact moment behind every point",
};

// The browser's own chrome (address bar, overscroll) matches the page in each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#04050d" },
  ],
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Before first paint, so a chosen theme never flashes the other one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="relative isolate flex min-h-full flex-col font-sans text-base">
        <Ambient />
        {children}
      </body>
    </html>
  );
}
