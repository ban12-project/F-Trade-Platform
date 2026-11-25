import type { VideoRenderRequest } from "./rendering";

function assTimestamp(seconds: number) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

function assText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\n", "\\N");
}

function dialogueLine(
  layer: 0 | 1,
  startSeconds: number,
  endSeconds: number,
  style: "Caption" | "CaptionAboveCta" | "CTA",
  text: string,
) {
  return `Dialogue: ${layer},${assTimestamp(startSeconds)},${assTimestamp(endSeconds)},${style},,0,0,0,,${assText(text)}`;
}

/**
 * Generates an ASS subtitle track where CTAs stay in the lower safe zone
 * (Alignment=2) rather than overlapping the product center (Alignment=5),
 * and subtitles lift into CaptionAboveCta during CTA overlap windows.
 */
export function buildMarketingAssDocument(request: VideoRenderRequest): string {
  const cta = request.timeline.cta;
  const captionLines = request.timeline.scenes
    .flatMap((scene) => scene.subtitles)
    .flatMap((subtitle) => {
      if (subtitle.endSeconds <= subtitle.startSeconds) return [];
      if (
        !cta ||
        subtitle.endSeconds <= cta.startSeconds ||
        subtitle.startSeconds >= cta.endSeconds
      ) {
        return [
          dialogueLine(0, subtitle.startSeconds, subtitle.endSeconds, "Caption", subtitle.text),
        ];
      }
      const segments: string[] = [];
      if (subtitle.startSeconds < cta.startSeconds) {
        segments.push(
          dialogueLine(0, subtitle.startSeconds, cta.startSeconds, "Caption", subtitle.text),
        );
      }
      const overlapStart = Math.max(subtitle.startSeconds, cta.startSeconds);
      const overlapEnd = Math.min(subtitle.endSeconds, cta.endSeconds);
      if (overlapEnd > overlapStart) {
        segments.push(dialogueLine(0, overlapStart, overlapEnd, "CaptionAboveCta", subtitle.text));
      }
      if (subtitle.endSeconds > cta.endSeconds) {
        segments.push(
          dialogueLine(0, cta.endSeconds, subtitle.endSeconds, "Caption", subtitle.text),
        );
      }
      return segments;
    });
  const ctaLines = cta ? [dialogueLine(1, cta.startSeconds, cta.endSeconds, "CTA", cta.text)] : [];
  const captionFontSize = Math.max(30, Math.round(request.height * 0.038));
  const captionMarginX = Math.max(48, Math.round(request.width * 0.06));
  const captionMarginV = Math.max(48, Math.round(request.height * 0.065));
  const captionAboveCtaMarginV = Math.max(116, Math.round(request.height * 0.165));
  const ctaFontSize = Math.max(36, Math.round(request.height * 0.046));
  const ctaMarginX = Math.max(64, Math.round(request.width * 0.08));
  const ctaMarginV = Math.max(44, Math.round(request.height * 0.065));
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${request.width}`,
    `PlayResY: ${request.height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,Noto Sans,${captionFontSize},&H00FFFFFF,&H000000FF,&H00111111,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,${captionMarginX},${captionMarginX},${captionMarginV},1`,
    `Style: CaptionAboveCta,Noto Sans,${captionFontSize},&H00FFFFFF,&H000000FF,&H00111111,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,${captionMarginX},${captionMarginX},${captionAboveCtaMarginV},1`,
    `Style: CTA,Noto Sans,${ctaFontSize},&H00FFFFFF,&H000000FF,&H00111111,&H90000000,-1,0,0,0,100,100,0,0,3,2,0,2,${ctaMarginX},${ctaMarginX},${ctaMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...captionLines,
    ...ctaLines,
    "",
  ].join("\n");
}
