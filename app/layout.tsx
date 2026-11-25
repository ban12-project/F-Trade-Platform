import type { Metadata, Viewport } from "next";

import "./globals.css";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { TestingRootFailure } from "./testing/error-recovery/root-failure";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "F-Trade 工作台",
    template: "%s · F-Trade",
  },
  description: "面向外贸企业的工作流平台，统一管理产品资料、营销内容、客户询盘与人工报价。",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={cn("font-sans", geist.variable)}>
      <body>
        {process.env.NEXT_ENABLE_TESTING_API === "1" ? <TestingRootFailure /> : null}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
        >
          跳到主要内容
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
