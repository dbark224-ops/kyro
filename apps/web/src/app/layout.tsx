import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";

const satoshi = localFont({
  display: "swap",
  src: [
    {
      path: "./fonts/Satoshi-Variable.woff2",
      style: "normal",
      weight: "300 900",
    },
    {
      path: "./fonts/Satoshi-VariableItalic.woff2",
      style: "italic",
      weight: "300 900",
    },
  ],
  variable: "--font-satoshi",
});

export const metadata: Metadata = {
  title: "Kyro",
  description: "AI business assistant for sole traders",
  icons: {
    apple: "/kyro-icon.png",
    icon: "/kyro-icon.png",
    shortcut: "/kyro-icon.png",
  },
};

const themeModeScript = `
try {
  var mode = window.localStorage.getItem("kyro:theme-mode");
  if (mode === "light" || mode === "dark") {
    document.documentElement.dataset.theme = mode;
  } else {
    delete document.documentElement.dataset.theme;
  }
} catch (_) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={satoshi.variable} lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="kyro-theme-mode"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeModeScript }}
        />
        {children}
      </body>
    </html>
  );
}
