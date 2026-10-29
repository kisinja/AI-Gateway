// app/layout.tsx  (replaces your existing file)
import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const ui = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-ui" });

export const metadata: Metadata = {
  title: "Gateway console",
  description: "Usage, budgets and API keys for the AI gateway",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${ui.variable} antialiased`}>{children}</body>
    </html>
  );
}
