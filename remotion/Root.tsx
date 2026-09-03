import { Composition } from "remotion";

import { AbcdMarketingVideo } from "./AbcdMarketingVideo";
import { compositionDurationInFrames, type AbcdMarketingVideoProps } from "./abcd-types";

const placeholder = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1080' height='1920'%3E%3Crect width='100%25' height='100%25' fill='%2318181b'/%3E%3C/svg%3E";
const defaultProps: AbcdMarketingVideoProps = {
  productName: "Verified product",
  ctaText: "Contact our sales team",
  fps: 30,
  clips: [{
    id: "clip-preview",
    src: placeholder,
    mediaType: "image",
    trimStartFrame: 0,
    durationInFrames: 240,
    fitMode: "contain",
    audioMode: "muted",
    caption: "Built for distributor inquiries",
    abcdRoles: ["attention", "branding", "connection", "direction"],
    motionPreset: "punch_in",
  }],
};

export function RemotionRoot() {
  return <Composition
    id="AbcdIndustrialVertical"
    component={AbcdMarketingVideo}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={compositionDurationInFrames(defaultProps)}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: compositionDurationInFrames(props), fps: props.fps })}
  />;
}

