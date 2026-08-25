import type { Metadata, Viewport } from "next";
import { Silkscreen, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const display = Silkscreen({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--f-display",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--f-mono",
  display: "swap",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--f-serif",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#06070a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://stockmonsters.example"),
  title: {
    default: "Stockmonsters — 194 tickers. One pixel ledger.",
    template: "%s · Stockmonsters",
  },
  description:
    "194 US stock tickers reimagined as collectible monsters in a playable retro RPG. Browse the full ledger, learn the type chart, then play it in your browser.",
  openGraph: {
    title: "Stockmonsters — 194 tickers. One pixel ledger.",
    description:
      "194 US stock tickers reimagined as collectible monsters in a playable retro RPG.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Stockmonsters title screen" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stockmonsters — 194 tickers. One pixel ledger.",
    description:
      "194 US stock tickers reimagined as collectible monsters in a playable retro RPG.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${serif.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
