import type { EvidenceOption } from "./access";

export type EvidenceChoice = {
  id: string;
  label: string;
  detail?: string;
  contentType?: string;
  inCurrentProject?: boolean;
};

export type EvidenceDisplayItem = {
  id: string;
  rawLabel: string;
  primaryLabel: string;
  typeBadge: string;
  dateLabel: string;
  detailText: string;
  displayText: string;
  hasDuplicate: boolean;
  group: "current" | "other";
  keywords: string[];
};

const opaqueLabelMap: Record<string, string> = {
  "marketing-upload:video": "已上传视频素材",
  "marketing-upload:image": "已上传图片素材",
};

export function formatEvidenceTypeBadge(contentType?: string): string {
  if (!contentType) return "";
  const normalized = contentType.trim().toLowerCase();
  if (!normalized.includes("/")) return "";
  if (normalized === "application/pdf") return "PDF";
  if (normalized === "text/csv") return "CSV";
  if (
    normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    normalized === "application/vnd.ms-excel"
  ) {
    return "Excel";
  }
  if (normalized === "video/quicktime") return "MOV 视频";
  if (normalized === "video/mp4") return "MP4 视频";
  if (normalized.startsWith("video/")) return "视频";
  if (normalized.startsWith("image/")) return "图片";
  return normalized;
}

export function formatEvidenceSourceLabel(sourceLabel: string, contentType?: string): string {
  const trimmed = sourceLabel.trim();
  if (!trimmed) return "未命名资料";
  if (trimmed in opaqueLabelMap) return opaqueLabelMap[trimmed];
  if (trimmed.startsWith("marketing-upload:")) {
    const typeLabel = formatEvidenceTypeBadge(contentType);
    return typeLabel ? `已上传${typeLabel}` : "已上传营销素材";
  }
  return trimmed;
}

function extractDateFromDetail(detail?: string): string {
  if (!detail) return "";
  const match = /\b\d{4}-\d{2}-\d{2}\b/.exec(detail);
  return match ? match[0] : "";
}

function extractTypeFromDetail(detail?: string, contentType?: string): string {
  if (contentType) return formatEvidenceTypeBadge(contentType);
  if (!detail) return "";
  const segments = detail.split("·").map((segment) => segment.trim());
  for (const segment of segments) {
    const badge = formatEvidenceTypeBadge(segment);
    if (badge) return badge;
  }
  return "";
}

export function evidenceChoiceFromOption(option: EvidenceOption): EvidenceChoice {
  return {
    id: option.id,
    label: option.sourceLabel,
    detail: `${option.contentType} · ${option.createdAt.toISOString().slice(0, 10)}`,
    contentType: option.contentType,
    inCurrentProject: option.inCurrentProject ?? false,
  };
}

export function buildEvidenceDisplayItems(choices: EvidenceChoice[]): EvidenceDisplayItem[] {
  const primaryLabels = choices.map((choice) =>
    formatEvidenceSourceLabel(choice.label, choice.contentType ?? choice.detail?.split("·")[0]),
  );

  return choices.map((choice, index) => {
    const primaryLabel = primaryLabels[index];
    const typeBadge = extractTypeFromDetail(choice.detail, choice.contentType);
    const dateLabel = extractDateFromDetail(choice.detail);
    const hasDuplicate = choices.some(
      (other, otherIndex) => other.id !== choice.id && primaryLabels[otherIndex] === primaryLabel,
    );

    const extraDetail =
      !dateLabel && choice.detail && !choice.detail.includes("/") ? choice.detail.trim() : "";
    const detailParts = [dateLabel || extraDetail, typeBadge].filter(Boolean);
    const detailText = detailParts.join(" · ");
    const suffixParts = [
      dateLabel || extraDetail,
      typeBadge,
      hasDuplicate ? `#${choice.id.slice(-6)}` : "",
    ].filter(Boolean);

    const displayText = suffixParts.length
      ? `${primaryLabel} · ${suffixParts.join(" · ")}`
      : primaryLabel;

    return {
      id: choice.id,
      rawLabel: choice.label,
      primaryLabel,
      typeBadge,
      dateLabel,
      detailText,
      displayText,
      hasDuplicate,
      group: choice.inCurrentProject ? "current" : "other",
      keywords: [
        choice.label,
        primaryLabel,
        typeBadge,
        dateLabel || extraDetail,
        choice.id.slice(-8),
        choice.inCurrentProject ? "当前项目" : "历史",
      ].filter(Boolean),
    };
  });
}
