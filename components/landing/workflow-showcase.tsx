"use client";

import { CheckCircle2Icon, ClockIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { WORKFLOW_TABS } from "./landing-config";

export function WorkflowShowcase() {
  const [activeId, setActiveId] = useState<string>(WORKFLOW_TABS[0].id);
  const current = WORKFLOW_TABS.find((t) => t.id === activeId) ?? WORKFLOW_TABS[0];

  return (
    <div className="flex flex-col gap-8">
      {/* Compact workflow status strip (keeps readable Chinese labels always visible) */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            title: "产品资料",
            desc: "逐字段绑定工厂私有证据",
            status: "待核对",
            dark: false,
          },
          {
            title: "人工核验",
            desc: "事实、报价与交期均由人拍板",
            status: "人工把关",
            dark: true,
          },
          {
            title: "内容草稿",
            desc: "引用已核验产品，逐帖确认排期",
            status: "待审发布",
            dark: false,
          },
        ].map((item) => (
          <div
            key={item.title}
            className={`flex items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${
              item.dark
                ? "border-[#0b0b0a] bg-[#0b0b0a] text-white"
                : "border-[#e7e9e8] bg-white text-[#101112]"
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className={`truncate text-xs ${item.dark ? "text-white/55" : "text-[#6b6e70]"}`}>
                {item.desc}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                item.dark
                  ? "border-[#4AB0FF]/40 bg-[#4AB0FF]/10 text-[#4AB0FF]"
                  : "border-[#e7e9e8] bg-[#f6f5f1] text-[#3a3c3e]"
              }`}
            >
              {item.status}
            </span>
          </div>
        ))}
      </div>

      {/* 1Centre-style interactive workbench selector + clean live console frame */}
      <div className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr] lg:items-start">
        <div className="flex flex-col gap-2.5">
          {WORKFLOW_TABS.map((tab, idx) => {
            const isActive = tab.id === current.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveId(tab.id)}
                className={`group flex flex-col gap-2 rounded-2xl border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#101112] ${
                  isActive
                    ? "border-[#101112] bg-white shadow-[0_14px_40px_-20px_rgba(11,11,10,0.2)]"
                    : "border-[#e7e9e8] bg-white/70 hover:border-[#d6d9d8] hover:bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#6b6e70]">
                    0{idx + 1} · {tab.eyebrow}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] ${
                      isActive ? "bg-[#0b0b0a] text-[#4AB0FF]" : "bg-[#f6f5f1] text-[#6b6e70]"
                    }`}
                  >
                    {tab.statusBadge}
                  </span>
                </div>
                <h3 className="text-base font-medium tracking-[-0.02em] text-[#101112]">
                  {tab.title}
                </h3>
                {isActive ? (
                  <p className="text-sm leading-6 text-[#6b6e70]">{tab.subtitle}</p>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Simulated 1Centre-style application window */}
        <div className="overflow-hidden rounded-[22px] border border-[#d6d9d8] bg-white shadow-[0_24px_70px_-28px_rgba(11,11,10,0.18)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e7e9e8] bg-[#f6f5f1] px-5 py-3.5 text-xs">
            <span className="font-mono text-[#3a3c3e]">{current.breadcrumb}</span>
            <span className="rounded-full bg-[#0b0b0a] px-3 py-1 font-medium text-white">
              {current.actionLabel} →
            </span>
          </div>

          <div className="divide-y divide-[#e7e9e8]">
            {current.rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-[#fafbfa]"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-[#f6f5f1] font-mono text-xs text-[#6b6e70]">
                    {row.id}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#101112]">{row.primary}</p>
                    <p className="text-xs text-[#6b6e70]">{row.secondary}</p>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                    row.state === "verified"
                      ? "bg-[#e8f5ff] text-[#0a2240]"
                      : row.state === "active"
                        ? "bg-[#0b0b0a] text-[#4AB0FF]"
                        : "bg-[#f6f5f1] text-[#b5532c]"
                  }`}
                >
                  {row.state === "verified" ? (
                    <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
                  ) : row.state === "active" ? (
                    <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
                  ) : (
                    <ClockIcon className="size-3.5" aria-hidden="true" />
                  )}
                  {row.meta}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e7e9e8] bg-[#0b0b0a] px-5 py-4 text-white">
            <div>
              <p className="text-sm font-medium text-white">{current.footerTitle}</p>
              <p className="text-xs text-white/50">{current.footerMeta}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4AB0FF]/40 bg-[#4AB0FF]/15 px-3 py-1 text-xs font-medium text-[#4AB0FF]">
              ● {current.footerStatus}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
