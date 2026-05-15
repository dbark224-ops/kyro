import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kyro",
  description: "AI business assistant for sole traders",
  icons: {
    apple: "/kyro-icon.png",
    icon: "/kyro-icon.png",
    shortcut: "/kyro-icon.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
