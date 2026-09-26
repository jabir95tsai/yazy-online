import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host =
    incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol =
    incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "yazy battle!";
  const description =
    "開一桌，把六位代碼給朋友。沒有計時、沒有輸贏壓力，想聊多久就聊多久。";

  return {
    metadataBase: new URL(origin),
    title: {
      default: title,
      template: "%s｜yazy",
    },
    description,
    icons: {
      icon: "/favicon.svg",
    },
    openGraph: {
      title: "yazy battle!",
      description: "開一桌，把代碼給朋友。慢慢玩就好。",
      type: "website",
      url: origin,
      images: [`${origin}/og.png`],
    },
    twitter: {
      card: "summary_large_image",
      title: "yazy battle!",
      description: "開一桌，把代碼給朋友。慢慢玩就好。",
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
        className={`${geistSans.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
