import type { Metadata } from "next";
import localFont from "next/font/local";
import Shell from "@/components/Shell";
import "./globals.css";

const sans = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-sans-face",
  weight: "100 900",
  display: "swap",
});

const serif = localFont({
  src: [
    { path: "./fonts/SourceSerif4-Variable.woff2", style: "normal", weight: "200 900" },
    { path: "./fonts/SourceSerif4-Italic-Variable.woff2", style: "italic", weight: "200 900" },
  ],
  variable: "--font-serif-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Argus · Approval watch", template: "%s · Argus" },
  description:
    "Argus: AICTE approval workflow automation, compliance monitoring and alert management. Prototype with synthetic data, not an official AICTE system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
