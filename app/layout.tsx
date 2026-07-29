import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host =
    incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol =
    incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "YAZY CLUB｜線上骰子派對";
  const description =
    "揪 2–6 位朋友，用房間代碼立即開局。輪流擲骰、鎖定組合，寫下今晚最高分。";

  return {
    metadataBase: new URL(origin),
    title: {
      default: title,
      template: "%s｜YAZY CLUB",
    },
    description,
    openGraph: {
      title: "YAZY CLUB｜今晚，擲出你的傳說",
      description: "2–6 人線上骰子派對，用代碼加入房間。",
      type: "website",
      url: origin,
      images: [`${origin}/og.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "YAZY CLUB｜今晚，擲出你的傳說",
      description: "2–6 人線上骰子派對，用代碼加入房間。",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
