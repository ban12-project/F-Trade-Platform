"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ_ITEMS, type FaqItem } from "./landing-config";

const CATEGORIES: ReadonlyArray<"全部" | FaqItem["category"]> = [
  "全部",
  "产品与事实",
  "安全与把关",
  "渠道与部署",
];

export function LandingFaq() {
  const [category, setCategory] = useState<"全部" | FaqItem["category"]>("全部");
  const filtered =
    category === "全部" ? FAQ_ITEMS : FAQ_ITEMS.filter((item) => item.category === category);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const active = cat === category;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b0b0a] ${
                active
                  ? "border-[#0b0b0a] bg-[#0b0b0a] text-white"
                  : "border-[#d6d9d8] bg-white text-[#3a3c3e] hover:border-[#0b0b0a]"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      <Accordion className="rounded-[22px] border border-[#e7e9e8] bg-white px-6 py-2">
        {filtered.map((item) => (
          <AccordionItem key={item.id} value={item.id} className="border-[#e7e9e8]">
            <AccordionTrigger className="py-5 text-base font-medium text-[#0b0b0a] hover:no-underline">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="pb-5 text-sm leading-7 text-[#6b6e70]">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
