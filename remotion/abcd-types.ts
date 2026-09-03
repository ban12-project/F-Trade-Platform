export type AbcdRole = "attention" | "branding" | "connection" | "direction";
export type MotionPreset = "punch_in" | "hero_reveal" | "slow_pan" | "cta_hold";

export type AbcdMarketingVideoProps = {
  productName: string;
  ctaText: string;
  fps: number;
  clips: Array<{
    id: string;
    src: string;
    mediaType: "image" | "video";
    trimStartFrame: number;
    durationInFrames: number;
    fitMode: "contain" | "cover";
    audioMode: "muted" | "source";
    caption?: string;
    abcdRoles: AbcdRole[];
    motionPreset: MotionPreset;
  }>;
};

export const transitionFrames = 8;

export function compositionDurationInFrames(props: AbcdMarketingVideoProps) {
  return props.clips.reduce((total, clip) => total + clip.durationInFrames, 0)
    - Math.max(0, props.clips.length - 1) * transitionFrames;
}

