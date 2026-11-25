import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  AbsoluteFill,
  Freeze,
  Html5Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import type { AbcdMarketingVideoProps, AbcdPacingMode, MotionPreset } from "./abcd-types";
import { resolveAbcdBeatState, transitionFrames } from "./abcd-types";

const accent = "#f97316";
const ink = "#fafafa";

function captionFontSize(length: number) {
  if (length > 70) return 38;
  if (length > 40) return 46;
  return 52;
}

function motionTransform(
  preset: MotionPreset,
  frame: number,
  durationInFrames: number,
  fps: number,
) {
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const arrival = spring({ frame, fps, config: { damping: 18, stiffness: 110, mass: 0.8 } });
  if (preset === "punch_in") return `scale(${1.18 - arrival * 0.12})`;
  if (preset === "hero_reveal")
    return `scale(${1.08 - progress * 0.04}) translateY(${(1 - arrival) * 2.5}%)`;
  if (preset === "slow_pan") return `scale(1.1) translateX(${-3 + progress * 6}%)`;
  return `scale(${1.04 - progress * 0.02})`;
}

function MediaLayer({ clip }: { clip: AbcdMarketingVideoProps["clips"][number] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const commonStyle = {
    height: "100%",
    width: "100%",
    objectFit: clip.fitMode,
    transform: motionTransform(clip.motionPreset, frame, clip.durationInFrames, fps),
  } as const;
  return clip.mediaType === "image" ? (
    <Img src={clip.src} style={commonStyle} />
  ) : (
    <OffthreadVideo
      src={clip.src}
      trimBefore={clip.trimStartFrame}
      trimAfter={clip.trimStartFrame + clip.durationInFrames}
      muted
      style={commonStyle}
    />
  );
}

function Beat({
  clip,
  productName,
  ctaText,
  pacingMode,
}: {
  clip: AbcdMarketingVideoProps["clips"][number];
  productName: string;
  ctaText: string;
  pacingMode?: AbcdPacingMode;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 130 } });
  const beat = resolveAbcdBeatState(clip, frame, pacingMode);
  const phaseFrame = frame - beat.phaseStartFrame;
  const phaseEnter = spring({ frame: phaseFrame, fps, config: { damping: 20, stiffness: 130 } });
  const isCover = clip.fitMode === "cover";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#09090b",
        overflow: "hidden",
        fontFamily:
          '"Noto Sans", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Noto Color Emoji", sans-serif',
      }}
    >
      {!isCover ? (
        <AbsoluteFill style={{ filter: "blur(36px)", opacity: 0.42, transform: "scale(1.12)" }}>
          <MediaLayer clip={clip} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          inset: isCover ? 0 : 24,
          borderRadius: isCover ? 0 : 32,
          overflow: "hidden",
          boxShadow: isCover ? undefined : "0 24px 72px rgba(0,0,0,.38)",
        }}
      >
        <MediaLayer clip={clip} />
      </AbsoluteFill>
      {/* Keep the central 18%-66% product region bright and unobstructed while preserving caption contrast. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(9,9,11,.68) 0%, transparent 18%, transparent 66%, rgba(9,9,11,.84) 100%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: beat.branding ? enter : 0.72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 12, height: 42, borderRadius: 6, backgroundColor: accent }} />
          <div
            style={{
              color: ink,
              fontSize: 30,
              fontWeight: 800,
              overflowWrap: "anywhere",
              unicodeBidi: "plaintext",
            }}
          >
            {productName}
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: beat.direction ? 316 : 210,
          transform: `translateY(${(1 - phaseEnter) * 32}px)`,
          opacity: phaseEnter,
        }}
      >
        {clip.caption ? (
          <div
            style={{
              color: ink,
              fontSize: captionFontSize(clip.caption.length),
              lineHeight: 1.28,
              overflowWrap: "anywhere",
              unicodeBidi: "plaintext",
              fontWeight: 850,
              letterSpacing: 0,
              textShadow: "0 3px 20px rgba(0,0,0,.65)",
            }}
          >
            {clip.caption}
          </div>
        ) : null}
      </div>

      {beat.direction ? (
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            bottom: 168,
            minHeight: 96,
            padding: "18px 26px",
            textAlign: "center",
            overflowWrap: "anywhere",
            unicodeBidi: "plaintext",
            borderRadius: 24,
            backgroundColor: accent,
            color: "#18181b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 34,
            fontWeight: 900,
            letterSpacing: -0.6,
            transform: `scale(${0.95 + phaseEnter * 0.05})`,
            opacity: phaseEnter,
            boxShadow: "0 14px 40px rgba(249,115,22,.34)",
          }}
        >
          {ctaText}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

export function AbcdMarketingVideo({
  clips,
  productName,
  ctaText,
  pacingMode,
}: AbcdMarketingVideoProps) {
  return (
    <TransitionSeries>
      {clips.flatMap((clip, index) => {
        const sequence = (
          <TransitionSeries.Sequence
            key={clip.id}
            durationInFrames={
              clip.durationInFrames + (index < clips.length - 1 ? transitionFrames : 0)
            }
          >
            {clip.mediaType === "video" && clip.audioMode === "source" ? (
              <Sequence durationInFrames={clip.durationInFrames} layout="none">
                <Html5Audio
                  src={clip.src}
                  trimBefore={clip.trimStartFrame}
                  trimAfter={clip.trimStartFrame + clip.durationInFrames}
                />
              </Sequence>
            ) : null}
            <Freeze
              frame={clip.durationInFrames - 1}
              active={(frame) => frame >= clip.durationInFrames}
            >
              <Beat
                clip={clip}
                productName={productName}
                ctaText={ctaText}
                pacingMode={pacingMode}
              />
            </Freeze>
          </TransitionSeries.Sequence>
        );
        if (index === clips.length - 1) return [sequence];
        return [
          sequence,
          <TransitionSeries.Transition
            key={`${clip.id}-transition`}
            presentation={fade()}
            timing={linearTiming({ durationInFrames: transitionFrames })}
          />,
        ];
      })}
    </TransitionSeries>
  );
}
