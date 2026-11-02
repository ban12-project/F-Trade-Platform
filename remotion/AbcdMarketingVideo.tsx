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

import type { AbcdMarketingVideoProps, MotionPreset } from "./abcd-types";
import { resolveAbcdBeatState, transitionFrames } from "./abcd-types";

const accent = "#f97316";
const ink = "#fafafa";

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
}: {
  clip: AbcdMarketingVideoProps["clips"][number];
  productName: string;
  ctaText: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 130 } });
  const beat = resolveAbcdBeatState(clip, frame);
  const phaseFrame = frame - beat.phaseStartFrame;
  const phaseEnter = spring({ frame: phaseFrame, fps, config: { damping: 20, stiffness: 130 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#09090b",
        overflow: "hidden",
        fontFamily:
          '"Noto Sans", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Noto Color Emoji", sans-serif',
      }}
    >
      <AbsoluteFill style={{ filter: "blur(42px)", opacity: 0.5, transform: "scale(1.12)" }}>
        <MediaLayer clip={clip} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(9,9,11,.2) 0%, rgba(9,9,11,.05) 42%, rgba(9,9,11,.88) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          inset: 42,
          borderRadius: 44,
          overflow: "hidden",
          boxShadow: "0 28px 90px rgba(0,0,0,.42)",
        }}
      >
        <MediaLayer clip={clip} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(9,9,11,.82), transparent 25%, transparent 48%, rgba(9,9,11,.94))",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 74,
          right: 74,
          top: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: beat.branding ? enter : 0.88,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 14, height: 48, borderRadius: 8, backgroundColor: accent }} />
          <div
            style={{
              color: ink,
              fontSize: 32,
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
          left: 74,
          right: 74,
          bottom: beat.direction ? 360 : 240,
          transform: `translateY(${(1 - phaseEnter) * 42}px)`,
          opacity: phaseEnter,
        }}
      >
        {clip.caption ? (
          <div
            style={{
              color: ink,
              fontSize: (clip.caption?.length ?? 0) > 70 ? 42 : 56,
              lineHeight: 1.3,
              overflowWrap: "anywhere",
              unicodeBidi: "plaintext",
              fontWeight: 850,
              letterSpacing: 0,
              textShadow: "0 3px 24px rgba(0,0,0,.55)",
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
            left: 74,
            right: 74,
            bottom: 180,
            minHeight: 104,
            padding: "20px 28px",
            textAlign: "center",
            overflowWrap: "anywhere",
            unicodeBidi: "plaintext",
            borderRadius: 28,
            backgroundColor: accent,
            color: "#18181b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: -0.8,
            transform: `scale(${0.94 + phaseEnter * 0.06})`,
            opacity: phaseEnter,
            boxShadow: "0 16px 48px rgba(249,115,22,.36)",
          }}
        >
          {ctaText}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

export function AbcdMarketingVideo({ clips, productName, ctaText }: AbcdMarketingVideoProps) {
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
              <Beat clip={clip} productName={productName} ctaText={ctaText} />
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
