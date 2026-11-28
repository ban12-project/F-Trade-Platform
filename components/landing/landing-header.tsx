"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/ui/button";
import { LANDING_BRAND_CONFIG } from "./landing-config";

type HeaderTheme = "transparent" | "dark" | "ocean" | "canvas" | "linen";

const THEME_CLASSES: Record<
  HeaderTheme,
  {
    header: string;
    brandBox: string;
    brandText: string;
    navLink: string;
    authBtn: string;
  }
> = {
  transparent: {
    header: "border-transparent bg-transparent text-white",
    brandBox: "bg-white text-[#0b0b0a]",
    brandText: "text-white",
    navLink: "text-white/80 hover:text-white",
    authBtn: "text-white/85 hover:bg-white/10 hover:text-white",
  },
  dark: {
    header: "border-white/10 bg-[#0b0b0a]/85 text-white backdrop-blur-md",
    brandBox: "bg-white text-[#0b0b0a]",
    brandText: "text-white",
    navLink: "text-white/75 hover:text-white",
    authBtn: "text-white/85 hover:bg-white/10 hover:text-white",
  },
  ocean: {
    header: "border-[#4AB0FF]/15 bg-[#07182d]/85 text-white backdrop-blur-md",
    brandBox: "bg-white text-[#07182d]",
    brandText: "text-white",
    navLink: "text-white/80 hover:text-white",
    authBtn: "text-white/85 hover:bg-white/10 hover:text-white",
  },
  canvas: {
    header: "border-[#e7e9e8] bg-[#fafbfa]/90 text-[#0b0b0a] backdrop-blur-md",
    brandBox: "bg-[#0b0b0a] text-white",
    brandText: "text-[#0b0b0a]",
    navLink: "text-[#3a3c3e] hover:text-[#0b0b0a]",
    authBtn: "text-[#3a3c3e] hover:bg-[#ebedec] hover:text-[#0b0b0a]",
  },
  linen: {
    header: "border-[#e7e9e8] bg-[#f6f5f1]/92 text-[#0b0b0a] backdrop-blur-md",
    brandBox: "bg-[#0b0b0a] text-white",
    brandText: "text-[#0b0b0a]",
    navLink: "text-[#3a3c3e] hover:text-[#0b0b0a]",
    authBtn: "text-[#3a3c3e] hover:bg-[#e7e5df] hover:text-[#0b0b0a]",
  },
};

export function LandingHeader() {
  const [theme, setTheme] = useState<HeaderTheme>("transparent");

  useEffect(() => {
    let rafId = 0;

    const syncTheme = () => {
      rafId = 0;
      if (window.scrollY < 24) {
        setTheme("transparent");
        return;
      }

      const probeY = 36;
      const sections = document.querySelectorAll<HTMLElement>("[data-header-theme]");
      let matched: HeaderTheme = "dark";
      for (const el of sections) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= probeY && rect.bottom > probeY) {
          const val = el.dataset.headerTheme;
          if (val === "dark" || val === "ocean" || val === "canvas" || val === "linen") {
            matched = val;
          }
          break;
        }
      }
      setTheme(matched);
    };

    const onScroll = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(syncTheme);
      }
    };

    syncTheme();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const styles = THEME_CLASSES[theme];

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${styles.header}`}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6 lg:px-8">
        <div className="flex items-center">
          <Link
            href="/"
            className={`flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4AB0FF] ${styles.brandText}`}
          >
            <span
              className={`flex size-6 items-center justify-center rounded-md font-mono text-[11px] font-bold transition-colors duration-300 ${styles.brandBox}`}
              aria-hidden="true"
            >
              F
            </span>
            <span className="text-[16px] font-semibold leading-none tracking-[-0.02em]">
              {LANDING_BRAND_CONFIG.brandName}
            </span>
          </Link>

          <nav aria-label="主导航" className="ml-12 hidden items-center gap-8 lg:flex">
            {[
              ["#workflow", "工作流"],
              ["#open", "入库溯源"],
              ["#decide", "审批门禁"],
              ["#watch", "社媒矩阵"],
              ["#prove", "审计对比"],
              ["#faq", "常见问题"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className={`text-[14px] transition-colors duration-300 ${styles.navLink}`}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <LinkButton
            href="/auth"
            variant="ghost"
            size="sm"
            className={`rounded-full text-[13px] transition-colors duration-300 ${styles.authBtn}`}
          >
            登录工作台
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
