"use client";

import { ArrowRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { compute, draw, effect, frameLoop, init, storage, surface } from "vgpu";
import { LinkButton } from "@/components/ui/button";
import {
  HERO_STATS,
  LANDING_BRAND_CONFIG,
  SOCIAL_CHANNEL_STAGES,
  type SocialChannelStage,
} from "./landing-config";
import { sampleStagePointCloud } from "./point-cloud-sampler";
import computeShader from "./shaders/beam-particles-compute.wgsl";
import renderShader from "./shaders/beam-particles-render.wgsl";
import fieldBgShader from "./shaders/hero-field-bg.wgsl";

const LOGO_PARTICLES = 2400;
const FUNNEL_STREAMERS = 260;
const TOTAL_PARTICLES = LOGO_PARTICLES + FUNNEL_STREAMERS;
const WORKGROUP_SIZE = 64;
const PARTICLE_FLOATS = 16;

const HOLD_LOGO_SEC = 3.0;
const HOLD_BRAND_SEC = 5.6;
const DRAIN_SEC = 2.25;
const ENTER_SEC = 2.35;

type EngineStatus = "initializing" | "running" | "unsupported" | "error";

interface WebGpuBeamHeroProps {
  brandName?: string;
}

function heroFocus(w: number, h: number) {
  if (w < 768) {
    const stage = Math.min(360, Math.max(280, 0.8 * w));
    return { fx: 0.5 * w, fy: 64 + stage / 2, spread: 1.7 * stage, stage, phone: true };
  }
  return { fx: 0.5 * w, fy: 0.5 * h, spread: 1.45 * h, stage: h, phone: false };
}

export function WebGpuBeamHero({
  brandName = LANDING_BRAND_CONFIG.brandName,
}: WebGpuBeamHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<EngineStatus>("initializing");
  const [errorReason, setErrorReason] = useState<string>("");

  const stageStateRef = useRef({
    stageIdx: 0,
    phase: 0 as 0 | 1 | 2, // 0=hold/hover, 1=drain out past right edge, 2=enter new logo from center
    phaseElapsed: 0,
    pointerX: -1e6,
    pointerY: -1e6,
    lastPointerMs: -1e6,
    pulseAge: 1.0,
    pulseStrength: 0.0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      setStatus("unsupported");
      return;
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isTouchOnly =
      typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

    let cancelled = false;
    let loopHandle: { stop(): void } | null = null;
    let gpuCtx: Awaited<ReturnType<typeof init>> | null = null;
    let canvasSurface: ReturnType<typeof surface> | null = null;
    let simPipeline: ReturnType<typeof compute> | null = null;
    let bgPipeline: ReturnType<typeof effect> | null = null;
    let renderPipeline: ReturnType<typeof draw> | null = null;
    let unsubResize: (() => void) | null = null;

    async function boot() {
      if (!canvas) return;
      try {
        const gpu = await init({
          powerPreference: "high-performance",
          label: "f-trade-1centre-webgpu",
        });
        if (cancelled) {
          gpu.dispose();
          return;
        }
        gpuCtx = gpu;

        const targetSurface = surface(gpu, canvas, {
          autoResize: true,
          dpr: [1, 2],
          clearColor: [0.043, 0.043, 0.039, 1.0],
          label: "hero-convergence-surface",
        });
        canvasSurface = targetSurface;

        const clouds = SOCIAL_CHANNEL_STAGES.map((stage) =>
          sampleStagePointCloud(stage.id, LOGO_PARTICLES, brandName),
        );

        const initialStage = reducedMotion ? SOCIAL_CHANNEL_STAGES.length - 1 : 0;
        stageStateRef.current.stageIdx = initialStage;
        stageStateRef.current.phase = reducedMotion ? 0 : 2;
        stageStateRef.current.phaseElapsed = 0;

        const dims = {
          w: Math.max(canvas.clientWidth || 1280, 1),
          h: Math.max(canvas.clientHeight || 800, 1),
        };
        unsubResize = targetSurface.onResize(() => {
          dims.w = Math.max(canvas.clientWidth || 1280, 1);
          dims.h = Math.max(canvas.clientHeight || 800, 1);
        });

        const focus = heroFocus(dims.w, dims.h);
        const markR = focus.phone
          ? Math.min(0.19 * dims.w, 0.3 * focus.stage)
          : Math.min(dims.w * (dims.w < 640 ? 0.19 : 0.135), 0.25 * dims.h);
        const markX = focus.phone
          ? Math.max(0.235 * dims.w, 24 + markR)
          : dims.w * (dims.w < 640 ? 0.235 : 0.21);
        const markY = focus.fy;

        const initParticles = new Float32Array(TOTAL_PARTICLES * PARTICLE_FLOATS);
        const startCloud = clouds[initialStage] ?? clouds[0];
        for (let i = 0; i < TOTAL_PARTICLES; i++) {
          const b = i * PARTICLE_FLOATS;
          const r1 = ((i * 2654435761) >>> 0) / 4294967295;
          const r2 = (((i + 31) * 2246822519) >>> 0) / 4294967295;
          const r3 = (((i + 97) * 3266489917) >>> 0) / 4294967295;
          const r4 = (((i + 193) * 668265263) >>> 0) / 4294967295;
          if (i < LOGO_PARTICLES) {
            const hx = markX + (startCloud[i * 4] ?? 0) * markR;
            const hy = markY + (startCloud[i * 4 + 1] ?? 0) * markR;
            initParticles[b] = hx;
            initParticles[b + 1] = hy;
            initParticles[b + 2] = hx;
            initParticles[b + 3] = hy;
            initParticles[b + 4] = (hx + focus.fx) * 0.5;
            initParticles[b + 5] = hy;
            initParticles[b + 6] = reducedMotion ? 0.0 : 5.0;
            initParticles[b + 7] = 0.0;
            initParticles[b + 8] = startCloud[i * 4 + 2] ?? 0;
            initParticles[b + 9] = startCloud[i * 4 + 3] ?? 0;
            initParticles[b + 10] = 0.0;
            initParticles[b + 11] = 0.75 + 0.6 * r2;
            initParticles[b + 12] = r1;
            initParticles[b + 13] = r2;
            initParticles[b + 14] = (r3 - 0.5) * 2.0;
            initParticles[b + 15] = 0.0;
          } else {
            // 260 stochastic HeroField funnel streamers
            initParticles[b] = focus.fx;
            initParticles[b + 1] = focus.fy;
            initParticles[b + 2] = focus.fx;
            initParticles[b + 3] = focus.fy;
            initParticles[b + 6] = 4.0;
            initParticles[b + 7] = r2;
            initParticles[b + 8] = 1.0;
            initParticles[b + 9] = r3 < 0.28 ? 1.0 : 0.0;
            initParticles[b + 10] = 0.0;
            initParticles[b + 11] = 0.75 + 0.9 * r4;
            initParticles[b + 12] = r1;
            initParticles[b + 13] = r4;
            initParticles[b + 14] = 0.22 + 0.78 * r3;
            initParticles[b + 15] = Math.floor(r1 * 150);
          }
        }

        const particleStorage = storage(gpu, initParticles.byteLength, "read-write");
        particleStorage.write(initParticles);

        const targetStorage = storage(gpu, startCloud.byteLength, "read");
        targetStorage.write(startCloud);

        const firstStage = SOCIAL_CHANNEL_STAGES[initialStage] ?? SOCIAL_CHANNEL_STAGES[0];

        const bg = effect(gpu, fieldBgShader, {
          label: "hero-field-bg",
          set: {
            params: {
              width: dims.w,
              height: dims.h,
              fx: focus.fx,
              fy: focus.fy,
              spread: focus.spread,
              time: 0,
              pulseAge: 1,
              pulseStrength: 0,
            },
          },
        });
        bgPipeline = bg;

        const sim = compute(gpu, computeShader, {
          label: "mark-stream-sim",
          set: {
            particles: particleStorage,
            targets: targetStorage,
            params: {
              width: dims.w,
              height: dims.h,
              fx: focus.fx,
              fy: focus.fy,
              markX,
              markY,
              markR,
              spread: focus.spread,
              dt: 0.016,
              time: 0,
              pointerX: -1e6,
              pointerY: -1e6,
              pointerInMark: 0,
              autoSweep: 0,
              logoCount: LOGO_PARTICLES,
              totalCount: TOTAL_PARTICLES,
              accentColor: [...firstStage.rgb, 1.0],
              switchPhase: 0,
              switchElapsed: 0,
              pad1: 0,
              pad2: 0,
            },
          },
        });
        simPipeline = sim;

        const renderer = draw(gpu, {
          shader: renderShader,
          vertices: 6,
          instances: TOTAL_PARTICLES,
          blend: "premultiplied",
          label: "mark-stream-draw",
          set: {
            particles: particleStorage,
            params: {
              width: dims.w,
              height: dims.h,
              dpr: Math.min(window.devicePixelRatio || 1, 2),
              pad: 0,
              accentColor: [...firstStage.rgb, 1.0],
            },
          },
        });
        renderPipeline = renderer;

        await Promise.all([bg.compile(targetSurface), sim.compile(), renderer.compile(targetSurface)]);
        if (cancelled) return;

        setStatus("running");

        let lastNow = performance.now();
        let totalTime = 0;

        loopHandle = frameLoop(gpu, (f) => {
          const now = performance.now();
          const dt = Math.min(0.05, Math.max(0.004, (now - lastNow) / 1000));
          lastNow = now;
          totalTime += dt;

          const state = stageStateRef.current;

          if (!reducedMotion) {
            state.phaseElapsed += dt;
            if (state.phase === 0) {
              const isBrand = state.stageIdx === SOCIAL_CHANNEL_STAGES.length - 1;
              const hold = isBrand ? HOLD_BRAND_SEC : HOLD_LOGO_SEC;
              if (state.phaseElapsed >= hold) {
                state.phase = 1;
                state.phaseElapsed = 0;
                state.pulseAge = 0.0;
                state.pulseStrength = 1.0;
              }
            } else if (state.phase === 1) {
              if (state.pulseAge > 0.55 && state.phaseElapsed < 1.2) {
                state.pulseAge = 0.0;
                state.pulseStrength = 0.9;
              }
              if (state.phaseElapsed >= DRAIN_SEC) {
                const nextIdx = (state.stageIdx + 1) % SOCIAL_CHANNEL_STAGES.length;
                state.stageIdx = nextIdx;
                state.phase = 2;
                state.phaseElapsed = 0;
                state.pulseAge = 0.0;
                state.pulseStrength = 1.0;
                targetStorage.write(clouds[nextIdx] ?? clouds[0]);
              }
            } else {
              if (state.phaseElapsed >= ENTER_SEC) {
                state.phase = 0;
                state.phaseElapsed = 0;
              }
            }
          }

          const curFocus = heroFocus(dims.w, dims.h);
          const curR = curFocus.phone
            ? Math.min(0.19 * dims.w, 0.3 * curFocus.stage)
            : Math.min(dims.w * (dims.w < 640 ? 0.19 : 0.135), 0.25 * dims.h);
          const curX = curFocus.phone
            ? Math.max(0.235 * dims.w, 24 + curR)
            : dims.w * (dims.w < 640 ? 0.235 : 0.21);
          const curY = curFocus.fy;

          const autoSweep = isTouchOnly && !reducedMotion && now - state.lastPointerMs > 2200;
          const ptrX = autoSweep
            ? curX + Math.sin(0.55 * totalTime) * curR * 0.62
            : state.pointerX;
          const ptrY = autoSweep
            ? curY + Math.sin(1.1 * totalTime) * curR * 0.42
            : state.pointerY;
          const inMark =
            state.phase === 0 && !reducedMotion && Math.hypot(ptrX - curX, ptrY - curY) < 1.15 * curR;

          if (inMark && state.pulseAge > 0.65) {
            state.pulseAge = 0.0;
            state.pulseStrength = 0.85;
          }
          state.pulseAge = Math.min(1.0, state.pulseAge + dt * 1.15);

          const stage: SocialChannelStage =
            SOCIAL_CHANNEL_STAGES[state.stageIdx] ?? SOCIAL_CHANNEL_STAGES[0];

          bg.set({
            params: {
              width: dims.w,
              height: dims.h,
              fx: curFocus.fx,
              fy: curFocus.fy,
              spread: curFocus.spread,
              time: totalTime,
              pulseAge: state.pulseAge,
              pulseStrength: state.pulseStrength,
            },
          });

          sim.set({
            params: {
              width: dims.w,
              height: dims.h,
              fx: curFocus.fx,
              fy: curFocus.fy,
              markX: curX,
              markY: curY,
              markR: curR,
              spread: curFocus.spread,
              dt,
              time: totalTime,
              pointerX: ptrX,
              pointerY: ptrY,
              pointerInMark: inMark ? 1.0 : 0.0,
              autoSweep: autoSweep ? 1.0 : 0.0,
              logoCount: LOGO_PARTICLES,
              totalCount: TOTAL_PARTICLES,
              accentColor: [...stage.rgb, 1.0],
              switchPhase: state.phase,
              switchElapsed: state.phaseElapsed,
              pad1: 0,
              pad2: 0,
            },
          });

          renderer.set({
            params: {
              width: dims.w,
              height: dims.h,
              dpr: Math.min(window.devicePixelRatio || 1, 2),
              pad: 0,
              accentColor: [...stage.rgb, 1.0],
            },
          });

          f.computePass({ label: "mark-stream-sim-pass" }, (pass) => {
            pass.dispatch(sim, Math.ceil(TOTAL_PARTICLES / WORKGROUP_SIZE));
          });
          f.pass(targetSurface, (pass) => {
            pass.draw(bg);
            pass.draw(renderer);
          });
        });
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorReason(err instanceof Error ? err.message : "WebGPU 初始化失败");
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      loopHandle?.stop();
      unsubResize?.();
      bgPipeline?.dispose();
      simPipeline?.dispose();
      renderPipeline?.dispose();
      canvasSurface?.dispose();
      gpuCtx?.dispose();
    };
  }, [brandName]);

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    stageStateRef.current.pointerX = e.clientX - rect.left;
    stageStateRef.current.pointerY = e.clientY - rect.top;
    stageStateRef.current.lastPointerMs = performance.now();
  };

  const handlePointerLeave = () => {
    stageStateRef.current.pointerX = -1e6;
    stageStateRef.current.pointerY = -1e6;
  };

  return (
    <section
      id="hero-convergence"
      data-dark="true"
      data-header-theme="dark"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative -mt-16 overflow-hidden bg-[#0b0b0a] text-white"
    >
      <div className="relative min-h-screen" data-phone-stage="true">
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(34%_40%_at_25%_50%,rgba(11,11,10,0.45)_0%,rgba(11,11,10,0)_100%)] md:block"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 top-[calc(64px+clamp(240px,68vw,340px)-72px)] bg-[linear-gradient(to_bottom,rgba(11,11,10,0)_0px,rgba(11,11,10,0.94)_96px,#0b0b0a_100%)] md:hidden"
        />

        {status === "unsupported" || status === "error" ? (
          <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-6 md:inset-y-0 md:right-1/2 md:top-0 md:items-center">
            <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#0b0b0a]/85 px-6 py-6 text-center backdrop-blur-md">
              <p className="text-2xl font-medium tracking-[-0.03em] text-white">{brandName}</p>
              <p className="text-xs leading-relaxed text-white/50">
                {status === "unsupported"
                  ? "当前浏览器未开启 WebGPU，请使用支持 WebGPU 的 Chrome / Edge / Safari 体验完整光束粒子交互。"
                  : `WebGPU 初始化未就绪：${errorReason}`}
              </p>
            </div>
          </div>
        ) : null}

        <div className="relative mx-auto grid min-h-screen w-full max-w-[1400px] content-start px-6 pb-14 md:grid-cols-2 md:grid-rows-2 md:content-normal md:pb-0 lg:px-8">
          <h1 className="landing-display pt-[calc(64px+clamp(240px,68vw,340px)+4px)] text-left text-[min(44px,calc((100vw-48px)/8.8))] leading-[1.06] text-white md:col-start-2 md:self-end md:pb-12 md:pt-24 md:text-[clamp(38px,4.4vw,62px)] md:leading-[1.02]">
            <span className="block">{LANDING_BRAND_CONFIG.heroLine1}</span>
            <span className="landing-glint block">{LANDING_BRAND_CONFIG.heroLine2}</span>
          </h1>

          <div className="pt-5 text-left md:col-start-2 md:row-start-2 md:pt-10">
            <p className="max-w-[580px] text-[clamp(15px,1.15vw,18px)] leading-[1.6] text-white/45">
              <span>{LANDING_BRAND_CONFIG.heroLeadPrefix}</span>
              <span className="text-white">{LANDING_BRAND_CONFIG.heroLeadHighlight}</span>
              <span>{LANDING_BRAND_CONFIG.heroLeadSuffix}</span>
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#workflow"
                className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full border border-white/20 px-6 text-[14px] text-white transition-colors hover:border-white/60"
              >
                查看工作流
              </a>
              <LinkButton
                href="/workspace"
                size="lg"
                className="h-11 rounded-full bg-white px-6 text-[14px] font-medium text-[#111110] hover:bg-[#e9e9e6]"
              >
                进入工作台 <ArrowRightIcon data-icon="inline-end" />
              </LinkButton>
            </div>

            <p className="mt-5 text-[12px] leading-5 text-white/35">
              {LANDING_BRAND_CONFIG.accessNote}
            </p>
          </div>
        </div>
      </div>

      <div className="relative grid border-t border-white/10 sm:grid-cols-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-px h-px overflow-hidden bg-gradient-to-r from-transparent via-[#4AB0FF]/25 to-transparent"
        >
          <span className="landing-stat-beam absolute inset-y-0 left-0 w-[30%] bg-gradient-to-r from-transparent via-[#4AB0FF] to-transparent shadow-[0_0_12px_rgba(74,176,255,0.95)]" />
          <span className="landing-stat-beam-delay absolute inset-y-0 left-0 w-[18%] bg-gradient-to-r from-transparent via-white/75 to-transparent" />
        </div>

        {HERO_STATS.map((stat, idx) => (
          <div
            key={stat.label}
            className={`flex items-center justify-center px-6 py-10 text-center lg:px-8 ${
              idx > 0 ? "border-t border-white/10 sm:border-l sm:border-t-0" : ""
            }`}
          >
            <div className="inline-block text-center sm:text-left">
              <p className="landing-display text-[clamp(34px,4vw,56px)] leading-none text-white">
                <span className="tabular-nums">{stat.value}</span>
                <span className="ml-1 text-[0.55em] text-[#4AB0FF]">{stat.suffix}</span>
              </p>
              <p className="mx-auto mt-3 max-w-[28ch] text-[13px] leading-snug text-white/45 sm:mx-0">
                {stat.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
