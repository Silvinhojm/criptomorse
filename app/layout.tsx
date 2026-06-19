import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ARCFLOW — Trading Automatizado Multi-Chain",
  description: "Seus robôs trabalhando para você 24h — Trading automatizado multi-chain com agentes inteligentes",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <meta name="talentapp:project_verification" content="a86bc5b3e4d61bf1baa1f88217333e7dcaf25934351cef9a9b037e22466fe7049c25ee38126b03e9defdd447e2c644af75d4af21ca321cc487760d848ca449c7" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}