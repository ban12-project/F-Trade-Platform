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

/**
 * Branding remains visible early and throughout its clip. The other ABCD roles
 * become ordered temporal beats when one source clip carries multiple roles.
 */
export function resolveAbcdBeatState(clip: AbcdMarketingVideoProps["clips"][number], frame: number) {
  const temporalRoles = (["attention", "connection", "direction"] as const).filter((role) => clip.abcdRoles.includes(role));
  const safeFrame = Math.max(0, Math.min(clip.durationInFrames - 1, Math.floor(frame)));
  const phaseIndex = temporalRoles.length <= 1
    ? 0
    : Math.min(temporalRoles.length - 1, Math.floor(safeFrame * temporalRoles.length / clip.durationInFrames));
  const activeRole = temporalRoles[phaseIndex];
  const phaseStartFrame = temporalRoles.length <= 1
    ? 0
    : Math.floor(phaseIndex * clip.durationInFrames / temporalRoles.length);
  return {
    attention: activeRole === "attention",
    branding: clip.abcdRoles.includes("branding"),
    connection: activeRole === "connection",
    direction: activeRole === "direction",
    phaseStartFrame,
  };
}
