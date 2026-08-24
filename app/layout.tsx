import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "F-Trade Platform",
  description: "AI-assisted foreign trade workflow MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
