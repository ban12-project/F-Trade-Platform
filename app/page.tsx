import { ArrowRightIcon, CheckIcon, LockIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import {
  COMPARISON_ROWS,
  LANDING_BRAND_CONFIG,
  MARQUEE_ITEMS,
  SOCIAL_CHANNEL_STAGES,
} from "@/components/landing/landing-config";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingHeader } from "@/components/landing/landing-header";
import { WebGpuBeamHero } from "@/components/landing/webgpu-beam-hero";
import { WorkflowShowcase } from "@/components/landing/workflow-showcase";
import { LinkButton } from "@/components/ui/button";

export default function HomePage() {
  const socialChannels = SOCIAL_CHANNEL_STAGES.filter((s) => s.status !== "brand");

  return (
    <main id="main-content" className="min-h-screen bg-[#fafbfa] text-[#101112] antialiased">
      {/* Scroll-adaptive Header that follows the background theme of each section */}
      <LandingHeader />

      {/* Section 0: Full-bleed Obsidian Hero + Pure WebGPU Right-to-Left Beam Convergence */}
      <WebGpuBeamHero brandName={LANDING_BRAND_CONFIG.brandName} />

      {/* Section 1: Dark Marquee Band */}
      <section
        data-header-theme="dark"
        className="overflow-hidden border-y border-white/10 bg-[#0b0b0a] py-5 text-white/55"
      >
        <div className="landing-marquee-track gap-10">
          {(["a", "b"] as const).flatMap((group) =>
            MARQUEE_ITEMS.map((item) => (
              <span
                key={`${group}-${item}`}
                className="inline-flex shrink-0 items-center gap-3 font-mono text-xs tracking-wide"
              >
                <span className="size-1.5 rounded-full bg-[#4AB0FF]/80" aria-hidden="true" />
                {item}
              </span>
            )),
          )}
        </div>
      </section>

      {/* Section 2: Light Canvas Interactive Workflow Showcase */}
      <section
        id="workflow"
        data-header-theme="canvas"
        className="mx-auto max-w-[1400px] scroll-mt-20 px-6 pb-20 pt-20 lg:px-8 lg:pt-28"
      >
        <div className="mb-12 max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#6b6e70]">
            Workflow Platform · MVP1 汽车离合器试点
          </p>
          <h2 className="landing-display mt-3 text-[clamp(30px,3.6vw,48px)] leading-[1.08] text-[#0b0b0a]">
            围绕工厂真实资料，构建可控的外贸业务工作流。
          </h2>
          <p className="mt-4 text-base leading-7 text-[#6b6e70]">
            从产品目录结构化、人工事实核验、多平台图文与 15
            秒实拍短视频，到受控社媒发布、被动询盘补全与人工报价，每一步都由领域状态机与独立审批记录约束。
          </p>
        </div>

        <WorkflowShowcase />
      </section>

      {/* Section 3: Warm Linen Chapter 01 — 导入。 */}
      <section
        id="open"
        data-header-theme="linen"
        className="scroll-mt-16 bg-[#f6f5f1] py-20 text-[#0b0b0a] lg:py-28"
      >
        <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#6b6e70]">
                01 · 入库即溯源
              </p>
              <h2 className="landing-display mt-3 text-[clamp(44px,5.6vw,76px)] leading-[0.98] text-[#0b0b0a]">
                导入。
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-[#3a3c3e] lg:text-lg">
              把分散在 PDF、CSV、Excel 与图册中的离合器产品资料上传至受限私有存储，由 Product Agent
              提取 OE
              号、车型适配、直径与花键参数，并强制逐字段绑定来源证据——缺失或无依据的参数自动阻断进入就绪状态。
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                step: "STEP 01",
                title: "私有目录上传",
                desc: "支持最大 25MB 的授权 PDF / CSV / XLS / XLSX，以受限私有对象保存，不暴露公开 URL。",
                tag: "Vercel Private Blob",
              },
              {
                step: "STEP 02",
                title: "字段级来源绑定",
                desc: "每一条 OE、车型、花键与摩擦材料参数必须关联具体证据页码或文件引用，拒绝 AI 自行猜测。",
                tag: "Evidence Bound",
              },
              {
                step: "STEP 03",
                title: "缺失项自动阻断",
                desc: "自动识别缺失的核心字段与未核验车型，只有人工核验批准后才允许流转至内容生成环节。",
                tag: "零幻觉防线",
              },
            ].map((card) => (
              <article
                key={card.step}
                className="flex flex-col justify-between gap-6 rounded-[22px] border border-[#e7e9e8] bg-white p-7"
              >
                <div>
                  <span className="font-mono text-[11px] tracking-[0.14em] text-[#6b6e70]">
                    {card.step}
                  </span>
                  <h3 className="mt-3 text-xl font-medium tracking-[-0.02em] text-[#0b0b0a]">
                    {card.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[#6b6e70]">{card.desc}</p>
                </div>
                <span className="w-fit rounded-full border border-[#e7e9e8] bg-[#f6f5f1] px-3 py-1 font-mono text-[11px] text-[#3a3c3e]">
                  {card.tag}
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Section 4: Obsidian Black Chapter 02 — 把关。 */}
      <section
        id="decide"
        data-header-theme="dark"
        className="scroll-mt-16 bg-[#0b0b0a] py-20 text-white lg:py-28"
      >
        <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div className="flex flex-col gap-6">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#4AB0FF]">
                02 · 三道强制人工防线
              </p>
              <h2 className="landing-display text-[clamp(44px,5.6vw,76px)] leading-[0.98] text-white">
                把关。
              </h2>
              <p className="max-w-xl text-base leading-7 text-white/50">
                <span className="text-white">
                  营销语言可以由 AI 辅助生成，但工程事实、正式报价与生产交期必须由人确认。
                </span>{" "}
                审批记录与业务对象在数据库中严格分表存储，运行时状态机在事务内校验审批人身份、时间与版本引用，彻底杜绝
                Agent 越权提交。
              </p>
              <div className="grid gap-3 pt-2 sm:grid-cols-3">
                {[
                  ["产品与内容真实性", "逐项核对 OE、参数与实拍图文"],
                  ["正式报价审批", "人工建单、确认 MOQ 与日历有效期"],
                  ["交期与产能确认", "工厂管理员确认，7 天有效期约束"],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-sm font-medium text-white">{t}</p>
                    <p className="mt-1.5 text-xs leading-5 text-white/45">{d}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#141413]">
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 text-xs">
                <span className="font-mono text-white/60">工作台 › 状态机门禁规则 › 事务校验</span>
                <span className="rounded-full border border-[#4AB0FF]/40 bg-[#4AB0FF]/15 px-3 py-0.5 font-mono text-[11px] text-[#4AB0FF]">
                  强制执行中
                </span>
              </div>
              <div className="flex flex-col gap-3 p-6 font-mono text-xs">
                <div className="rounded-xl border border-white/10 bg-[#0b0b0a] p-4">
                  <div className="flex items-center justify-between text-white/45">
                    <span>RULE 01 · 产品真实性</span>
                    <span className="text-[#4AB0FF]">✓ 已启用</span>
                  </div>
                  <p className="mt-2 text-sm text-white">
                    <span className="text-[#4AB0FF]">IF</span> 核心字段缺失 OR 未绑定私有证据
                    <br />
                    <span className="text-[#4AB0FF]">THEN</span> → 阻断就绪并退回修订
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#0b0b0a] p-4">
                  <div className="flex items-center justify-between text-white/45">
                    <span>RULE 02 · 正式报价边界</span>
                    <span className="text-[#4AB0FF]">✓ 已启用</span>
                  </div>
                  <p className="mt-2 text-sm text-white">
                    <span className="text-[#4AB0FF]">IF</span> 发起方为 Agent OR 缺少人工审批引用
                    <br />
                    <span className="text-[#4AB0FF]">THEN</span> → 服务端拒绝登记发送
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#0b0b0a] p-4">
                  <div className="flex items-center justify-between text-white/45">
                    <span>RULE 03 · 交期承诺有效期</span>
                    <span className="text-[#4AB0FF]">✓ 已启用</span>
                  </div>
                  <p className="mt-2 text-sm text-white">
                    <span className="text-[#4AB0FF]">IF</span> 交期确认超过 7 天 OR RFQ 不匹配
                    <br />
                    <span className="text-[#4AB0FF]">THEN</span> → 拦截回复并要求重新确认
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 5: Deep Midnight Ocean Blue Chapter 03 — 受控。 */}
      <section
        id="watch"
        data-header-theme="ocean"
        className="scroll-mt-16 bg-[linear-gradient(180deg,#061426_0%,#0a2240_38%,#082039_72%,#0b0b0a_100%)] py-20 text-white lg:py-28"
      >
        <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#4AB0FF]">
                03 · 单渠道跑通，全社媒矩阵演进
              </p>
              <h2 className="landing-display mt-3 text-[clamp(44px,5.6vw,76px)] leading-[0.98] text-white">
                受控。
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-white/60">
              第一阶段专注跑通{" "}
              <span className="text-white">Facebook 受控图文、15 秒实拍视频发布与被动 DM 入站</span>
              ，确保每条线索可归因；系统已预置多平台视频比例与静音可读规范，支持向
              YouTube、Instagram、TikTok、LinkedIn 与 X
              平滑演进。遇风控或页面异动即时熔断，绝不盲目重试。
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {socialChannels.map((ch) => (
              <div
                key={ch.id}
                className="flex flex-col justify-between gap-4 rounded-[20px] border border-white/10 bg-[#0b0b0a]/55 p-6 backdrop-blur-sm transition hover:border-[#4AB0FF]/45"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: ch.colorHex }}
                      aria-hidden="true"
                    />
                    <h3 className="text-base font-medium text-white">{ch.label}</h3>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                      ch.status === "supported"
                        ? "border-[#4AB0FF]/50 bg-[#4AB0FF]/15 text-[#4AB0FF]"
                        : "border-white/15 bg-white/5 text-white/60"
                    }`}
                  >
                    {ch.badge}
                  </span>
                </div>
                <p className="text-sm leading-6 text-white/55">{ch.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 6: Obsidian Black Chapter 04 — 留痕。 + Before/After Table */}
      <section
        id="prove"
        data-header-theme="dark"
        className="scroll-mt-16 bg-[#0b0b0a] py-20 text-white lg:py-28"
      >
        <div className="mx-auto max-w-[1400px] px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#4AB0FF]">
              04 · 留痕与效率对比
            </p>
            <h2 className="landing-display mt-3 text-[clamp(44px,5.6vw,76px)] leading-[0.98] text-white">
              留痕。
            </h2>
            <p className="mt-4 text-base leading-7 text-white/50">
              从目录导入到有效商机，每一条审批、发布回执与报价版本都沉淀在可审计的业务档案中，告别表格孤岛与口头承诺。
            </p>
          </div>

          <div className="mt-12 overflow-x-auto rounded-[22px] border border-white/10 bg-[#141413]">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/45">
                  <th className="px-6 py-4 font-medium">业务环节</th>
                  <th className="px-6 py-4 font-medium">传统作业方式</th>
                  <th className="px-6 py-4 font-medium text-[#4AB0FF]">
                    使用 {LANDING_BRAND_CONFIG.shortBrand}
                  </th>
                  <th className="px-6 py-4 font-medium">实际效果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.stage} className="transition hover:bg-white/[0.02]">
                    <td className="px-6 py-4 font-medium text-white">{row.stage}</td>
                    <td className="px-6 py-4 text-white/45">{row.before}</td>
                    <td className="px-6 py-4 text-white/85">{row.after}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4AB0FF]/35 bg-[#4AB0FF]/10 px-3 py-1 text-xs font-medium text-[#4AB0FF]">
                        <CheckIcon className="size-3" aria-hidden="true" />
                        {row.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Section 7: Warm Linen FAQ */}
      <section
        id="faq"
        data-header-theme="linen"
        className="scroll-mt-16 bg-[#f6f5f1] py-20 text-[#0b0b0a] lg:py-28"
      >
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="mb-10">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#6b6e70]">FAQ</p>
            <h2 className="landing-display mt-3 text-[clamp(30px,3.6vw,46px)] leading-[1.08] text-[#0b0b0a]">
              还有疑问？这里有清晰答案。
            </h2>
          </div>

          <LandingFaq />
        </div>
      </section>

      {/* Section 8: Final Ocean-Blue-to-Obsidian CTA Band */}
      <section
        data-header-theme="ocean"
        className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#0a2240_0%,#082039_45%,#061426_78%,#0b0b0a_100%)] py-24 text-white"
      >
        <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-8 px-6 lg:flex-row lg:items-center lg:px-8">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4AB0FF]/35 bg-[#4AB0FF]/10 px-3 py-1 text-xs text-[#4AB0FF]">
              <LockIcon className="size-3.5" aria-hidden="true" />
              邀请制安全访问 · 邮箱 OTP & Passkey
            </span>
            <h2 className="landing-display mt-5 text-[clamp(32px,4vw,52px)] leading-[1.05] text-white">
              资料有依据，报价有人审。
            </h2>
            <p className="mt-4 text-base leading-7 text-white/55">
              面向受邀外贸业务与工厂管理员开放。登录后即可按今日任务、产品资料、内容与发布、客户与询盘开展日常协同。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton
              href="/auth"
              size="lg"
              className="h-12 rounded-full bg-white px-7 text-[14px] font-medium text-[#0b0b0a] hover:bg-[#e9e9e6]"
            >
              前往受邀登录 <ArrowRightIcon data-icon="inline-end" />
            </LinkButton>
          </div>
        </div>
      </section>

      {/* Footer: Obsidian Black */}
      <footer
        data-header-theme="dark"
        className="relative overflow-hidden border-t border-white/10 bg-[#0b0b0a] py-10 text-xs text-white/45"
      >
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="flex items-center gap-2 text-white/75">
            <ShieldCheckIcon className="size-4 text-[#4AB0FF]" aria-hidden="true" />
            <span>© 2026 {LANDING_BRAND_CONFIG.brandName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            {process.env.NEXT_ENABLE_TESTING_API === "1" ? (
              <Link
                href="/testing"
                className="text-white/60 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4AB0FF]"
              >
                查看测试页面
              </Link>
            ) : null}
            <span>资料有依据 · 报价有人审</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
