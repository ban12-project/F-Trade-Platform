"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  BotIcon,
  CopyIcon,
  DownloadIcon,
  FilmIcon,
  PlusIcon,
  SaveIcon,
  ScissorsIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  copyMarketingVideoDraftAction,
  generateMarketingVideoAiDraftAction,
  renderMarketingVideoDraftAction,
  reviewMarketingVideoAction,
  saveMarketingVideoDraftAction,
} from "@/lib/actions/marketing-video";
import {
  type MarketingVideoDraft,
  marketingVideoDraftSchema,
  marketingVideoDurationMs,
} from "@/lib/video/edit-contracts";
import type {
  MarketingVideoCopyCandidate,
  MarketingVideoEditorEntry,
  ReadyVideoProductSource,
} from "@/lib/video/store";
import { MarketingVideoCreateForm } from "./marketing-video-create-form";

function stateLabel(state: string) {
  return (
    (
      {
        VIDEO_DRAFT: "编辑中",
        VIDEO_RENDERING: "合成中",
        VIDEO_REVIEW_REQUIRED: "待成片审核",
        VIDEO_REVISION_REQUIRED: "需要修改",
        VIDEO_APPROVED: "已通过",
      } as Record<string, string>
    )[state] ?? state
  );
}

const abcdRoleLabels = {
  attention: "Attention 抓注意",
  branding: "Branding 露品牌",
  connection: "Connection 建联系",
  direction: "Direction 给行动",
} as const;
const motionPresetLabels = {
  punch_in: "快速推进",
  hero_reveal: "产品揭示",
  slow_pan: "缓慢横移",
  cta_hold: "行动定格",
} as const;

function ClipEditor({
  draft,
  factOptions,
  onChange,
  disabled,
}: {
  draft: MarketingVideoDraft;
  factOptions: MarketingVideoEditorEntry["captionFactOptions"];
  onChange: (draft: MarketingVideoDraft) => void;
  disabled: boolean;
}) {
  function patchClip(index: number, patch: Partial<MarketingVideoDraft["clips"][number]>) {
    onChange({
      ...draft,
      clips: draft.clips.map((clip, clipIndex) =>
        clipIndex === index ? { ...clip, ...patch } : clip,
      ),
    });
  }
  function move(index: number, offset: -1 | 1) {
    const clips = [...draft.clips];
    const target = index + offset;
    if (target < 0 || target >= clips.length) return;
    [clips[index], clips[target]] = [clips[target]!, clips[index]!];
    onChange({ ...draft, clips });
  }
  function changeCaptionKind(index: number, kind: "none" | "creative" | "verified_fact") {
    const current = draft.clips[index]!.caption;
    if (kind === "none") patchClip(index, { caption: { kind } });
    else if (kind === "creative")
      patchClip(index, {
        caption: { kind, text: current.kind === "creative" ? current.text : "" },
      });
    else if (factOptions[0])
      patchClip(index, {
        caption: {
          kind,
          claimRef: current.kind === "verified_fact" ? current.claimRef : factOptions[0].field,
        },
      });
  }
  return (
    <FieldSet disabled={disabled}>
      <FieldLegend>剪辑顺序</FieldLegend>
      <div className="flex flex-col gap-3">
        {draft.clips.map((clip, index) => (
          <Card key={clip.clipId}>
            <CardHeader className="flex-row items-start justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-sm">片段 {index + 1}</CardTitle>
                <CardDescription>
                  {clip.mediaType === "image" ? "图片" : "视频"} · {clip.assetRef.slice(0, 20)}…
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`片段 ${index + 1} 上移`}
                  disabled={index === 0 || disabled}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`片段 ${index + 1} 下移`}
                  disabled={index === draft.clips.length - 1 || disabled}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel>ABCD 节拍</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {clip.abcdRoles.map((role) => (
                      <Badge key={role} variant="outline">
                        {abcdRoleLabels[role]}
                      </Badge>
                    ))}
                  </div>
                  <FieldDescription>
                    AI 可以让同一素材承担多个节拍，但整条视频必须覆盖 ABCD。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${clip.clipId}-motion`}>运动方式</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    id={`${clip.clipId}-motion`}
                    value={clip.motionPreset}
                    onChange={(event) =>
                      patchClip(index, {
                        motionPreset: event.target.value as keyof typeof motionPresetLabels,
                      })
                    }
                  >
                    {Object.entries(motionPresetLabels).map(([value, label]) => (
                      <NativeSelectOption key={value} value={value}>
                        {label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {clip.sourceAnalysis ? (
                  <Field>
                    <FieldLabel>自动镜头分析</FieldLabel>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        区间 {(clip.sourceAnalysis.intervalStartMs / 1_000).toFixed(1)}–
                        {(clip.sourceAnalysis.intervalEndMs / 1_000).toFixed(1)} 秒
                      </Badge>
                      <Badge variant="outline">
                        代表帧 {(clip.sourceAnalysis.representativeMs / 1_000).toFixed(1)} 秒
                      </Badge>
                      <Badge variant="secondary">
                        视觉动作 {clip.sourceAnalysis.actionScore}/100 ·{" "}
                        {{ low: "低", medium: "中", high: "高" }[clip.sourceAnalysis.actionLevel]}
                      </Badge>
                    </div>
                    <FieldDescription>
                      动作分只表示相邻画面的变化强度，不代表内容质量；截取范围被限制在同一检测区间内。
                    </FieldDescription>
                  </Field>
                ) : null}
                {clip.mediaType === "video" ? (
                  <Field>
                    <FieldLabel htmlFor={`${clip.clipId}-start`}>源素材起点（秒）</FieldLabel>
                    <Input
                      id={`${clip.clipId}-start`}
                      type="number"
                      min={(clip.sourceAnalysis?.intervalStartMs ?? 0) / 1_000}
                      max={
                        clip.sourceAnalysis
                          ? Math.max(
                              clip.sourceAnalysis.intervalStartMs,
                              clip.sourceAnalysis.intervalEndMs - clip.durationMs,
                            ) / 1_000
                          : undefined
                      }
                      step="0.1"
                      value={clip.trimStartMs / 1_000}
                      onChange={(event) =>
                        patchClip(index, {
                          trimStartMs: Math.max(
                            clip.sourceAnalysis?.intervalStartMs ?? 0,
                            Math.round(Number(event.target.value) * 1_000),
                          ),
                        })
                      }
                    />
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor={`${clip.clipId}-duration`}>成片时长（秒）</FieldLabel>
                  <Input
                    id={`${clip.clipId}-duration`}
                    type="number"
                    min="1"
                    max={
                      clip.sourceAnalysis
                        ? Math.min(
                            10,
                            (clip.sourceAnalysis.intervalEndMs - clip.trimStartMs) / 1_000,
                          )
                        : 10
                    }
                    step="0.1"
                    value={clip.durationMs / 1_000}
                    onChange={(event) =>
                      patchClip(index, {
                        durationMs: Math.round(Number(event.target.value) * 1_000),
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>画面适配</FieldLabel>
                  <ToggleGroup
                    value={[clip.fitMode]}
                    onValueChange={(value) =>
                      value[0] && patchClip(index, { fitMode: value[0] as "contain" | "cover" })
                    }
                    variant="outline"
                  >
                    <ToggleGroupItem value="contain">完整显示</ToggleGroupItem>
                    <ToggleGroupItem value="cover">铺满裁切</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                {clip.mediaType === "video" ? (
                  <Field>
                    <FieldLabel>声音</FieldLabel>
                    <ToggleGroup
                      value={[clip.audioMode]}
                      onValueChange={(value) =>
                        value[0] && patchClip(index, { audioMode: value[0] as "muted" | "source" })
                      }
                      variant="outline"
                    >
                      <ToggleGroupItem value="muted">静音</ToggleGroupItem>
                      <ToggleGroupItem value="source">保留原声</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor={`${clip.clipId}-caption-kind`}>字幕类型</FieldLabel>
                  <NativeSelect
                    className="w-full"
                    id={`${clip.clipId}-caption-kind`}
                    value={clip.caption.kind}
                    onChange={(event) =>
                      changeCaptionKind(
                        index,
                        event.target.value as "none" | "creative" | "verified_fact",
                      )
                    }
                  >
                    <NativeSelectOption value="none">无字幕</NativeSelectOption>
                    <NativeSelectOption value="creative">创意文案</NativeSelectOption>
                    <NativeSelectOption value="verified_fact">核验事实</NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>
                    事实字幕由服务端读取当前 ProductReady 值，不能手工改写。
                  </FieldDescription>
                </Field>
                {clip.caption.kind === "creative" ? (
                  <Field>
                    <FieldLabel htmlFor={`${clip.clipId}-caption-text`}>创意字幕</FieldLabel>
                    <Textarea
                      id={`${clip.clipId}-caption-text`}
                      maxLength={120}
                      value={clip.caption.text}
                      onChange={(event) =>
                        patchClip(index, {
                          caption: { kind: "creative", text: event.target.value },
                        })
                      }
                    />
                    <FieldDescription>
                      仅写营销表达；工程和商业事实请使用“核验事实”。
                    </FieldDescription>
                  </Field>
                ) : null}
                {clip.caption.kind === "verified_fact" ? (
                  <Field>
                    <FieldLabel htmlFor={`${clip.clipId}-caption-fact`}>事实字段</FieldLabel>
                    <NativeSelect
                      className="w-full"
                      id={`${clip.clipId}-caption-fact`}
                      value={clip.caption.claimRef}
                      onChange={(event) =>
                        patchClip(index, {
                          caption: { kind: "verified_fact", claimRef: event.target.value },
                        })
                      }
                    >
                      {factOptions.map((fact) => (
                        <NativeSelectOption key={fact.field} value={fact.field}>
                          {fact.field} · {fact.value}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>
                      成片使用服务端保存的核验值，不接受浏览器提交事实文字。
                    </FieldDescription>
                  </Field>
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>
        ))}
      </div>
    </FieldSet>
  );
}

function EditVideo({
  projectId,
  entry,
  canReview,
  onDirtyChange,
}: {
  projectId: string;
  entry: MarketingVideoEditorEntry;
  canReview: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startAction] = useTransition();
  const [draft, setDraft] = useState(entry.draft);
  const [message, setMessage] = useState("");
  const [reviewEvidence, setReviewEvidence] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry.draft);
  const durationMs = marketingVideoDurationMs(draft);
  const editable = ["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(entry.state);
  const processing =
    entry.processingJob?.status === "queued" || entry.processingJob?.status === "running";
  useEffect(() => {
    setDraft(entry.draft);
  }, [entry.draft]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [processing, router]);
  function run(action: () => Promise<{ status: string; message: string }>) {
    startAction(async () => {
      const result = await action();
      setMessage(result.message);
      if (result.status === "success") router.refresh();
    });
  }
  function validatedDraft() {
    const result = marketingVideoDraftSchema.safeParse(draft);
    if (!result.success) {
      setMessage(result.error.issues[0]?.message ?? "剪辑稿无效。");
      return null;
    }
    return result.data;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{stateLabel(entry.state)}</Badge>
        {processing ? <Badge>后台处理中</Badge> : null}
        {entry.privateTestOnly ? <Badge variant="outline">仅限私有测试</Badge> : null}
        <Badge variant="outline">{entry.draft.platform}</Badge>
        <Badge variant="outline">最长 15 秒</Badge>
      </div>
      <div>
        <h3 className="font-medium">{entry.productName}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{entry.objective}</p>
      </div>
      {entry.previewAssetRef ? (
        <Card>
          <CardHeader>
            <CardTitle>私有预览</CardTitle>
            <CardDescription>
              {entry.privateTestOnly
                ? "互联网测试素材不能批准、下载或发布。"
                : "审核通过也不会自动发布。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <video
              muted
              className="aspect-video w-full rounded-lg bg-muted"
              controls
              preload="metadata"
              src={`/api/video-preview/${entry.previewAssetRef}`}
            />
          </CardContent>
          {entry.downloadAvailable ? (
            <CardFooter className="flex flex-wrap gap-2">
              <LinkButton
                className="flex-1"
                href={`/api/video-download/${entry.id}`}
                download
                prefetch={false}
              >
                <DownloadIcon data-icon="inline-start" />
                下载 MP4
              </LinkButton>
              <LinkButton
                variant="outline"
                className="flex-1"
                href={`/api/video-download/${entry.id}/manifest`}
                download
                prefetch={false}
              >
                <DownloadIcon data-icon="inline-start" />
                下载导出清单
              </LinkButton>
            </CardFooter>
          ) : null}
        </Card>
      ) : null}
      {editable ? (
        <>
          <Progress aria-label="视频总时长" value={Math.min(100, durationMs / 150)}>
            <ProgressLabel>总时长</ProgressLabel>
            <ProgressValue>{() => `${(durationMs / 1_000).toFixed(1)} / 15 秒`}</ProgressValue>
          </Progress>
          {durationMs > 15_000 ? (
            <Alert variant="destructive">
              <AlertTitle>视频过长</AlertTitle>
              <AlertDescription>请缩短片段，总时长必须不超过 15 秒。</AlertDescription>
            </Alert>
          ) : null}
          <ClipEditor
            draft={draft}
            factOptions={entry.captionFactOptions}
            onChange={setDraft}
            disabled={pending || processing}
          />
          <Separator />
          <Field>
            <FieldLabel htmlFor="video-cta">最后两秒 CTA</FieldLabel>
            <Input
              id="video-cta"
              maxLength={40}
              value={draft.ctaText}
              onChange={(event) => setDraft({ ...draft, ctaText: event.target.value })}
            />
            <FieldDescription>固定居中样式，不增加视频总时长。</FieldDescription>
          </Field>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              variant="outline"
              disabled={pending || processing}
              onClick={() => run(() => generateMarketingVideoAiDraftAction(projectId, entry.id))}
            >
              <BotIcon data-icon="inline-start" />
              AI 初稿
            </Button>
            <Button
              variant="outline"
              disabled={pending || processing || !dirty}
              onClick={() => {
                const value = validatedDraft();
                if (value) run(() => saveMarketingVideoDraftAction(projectId, entry.id, value));
              }}
            >
              <SaveIcon data-icon="inline-start" />
              保存
            </Button>
            <Button
              disabled={pending || processing || durationMs > 15_000}
              onClick={() => {
                const value = validatedDraft();
                if (value) run(() => renderMarketingVideoDraftAction(projectId, entry.id, value));
              }}
            >
              <ScissorsIcon data-icon="inline-start" />
              合成预览
            </Button>
          </div>
        </>
      ) : null}
      {entry.state === "VIDEO_RENDERING" ? (
        <Alert>
          <FilmIcon />
          <AlertTitle>正在合成</AlertTitle>
          <AlertDescription>服务器正在生成私有预览，请稍后刷新。</AlertDescription>
        </Alert>
      ) : null}
      {entry.processingJob?.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>
            {entry.processingJob.kind === "render" ? "合成失败" : "AI 初稿失败"}
          </AlertTitle>
          <AlertDescription>
            {entry.processingJob.failureMessage ?? "后台任务失败，请重试。"}
          </AlertDescription>
        </Alert>
      ) : null}
      {entry.state === "VIDEO_REVIEW_REQUIRED" && entry.privateTestOnly ? (
        <Alert>
          <AlertTitle>保持私有测试</AlertTitle>
          <AlertDescription>
            该视频包含互联网检索素材，系统不会提供批准或下载操作。需要正式使用时，请换成已授权
            ProductMedia。
          </AlertDescription>
        </Alert>
      ) : null}
      {entry.state === "VIDEO_REVIEW_REQUIRED" && canReview && !entry.privateTestOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>成片审核</CardTitle>
            <CardDescription>核对画面、字幕、CTA 和产品事实后再决定。</CardDescription>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="video-review-evidence">审核证据</FieldLabel>
              <Input
                id="video-review-evidence"
                placeholder="evidence-review-001"
                value={reviewEvidence}
                onChange={(event) => setReviewEvidence(event.target.value)}
              />
            </Field>
          </CardContent>
          <CardFooter className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={pending || !reviewEvidence}
              onClick={() =>
                run(() =>
                  reviewMarketingVideoAction(
                    projectId,
                    entry.id,
                    "rejected",
                    reviewEvidence,
                    "成片需要修改",
                  ),
                )
              }
            >
              退回修改
            </Button>
            <Button
              disabled={pending || !reviewEvidence}
              onClick={() =>
                run(() =>
                  reviewMarketingVideoAction(
                    projectId,
                    entry.id,
                    "approved",
                    reviewEvidence,
                    "成片已人工确认",
                  ),
                )
              }
            >
              通过成片
            </Button>
          </CardFooter>
        </Card>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function MarketingVideoPanel({
  projectId,
  products,
  entries,
  copyCandidates,
  canReview,
  selectedId,
  onDirtyChange,
}: {
  projectId: string;
  products: ReadyVideoProductSource[];
  entries: MarketingVideoEditorEntry[];
  copyCandidates: MarketingVideoCopyCandidate[];
  canReview: boolean;
  selectedId?: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [activeId, setActiveId] = useState(
    selectedId && entries.some((entry) => entry.id === selectedId)
      ? selectedId
      : (entries[0]?.id ?? "new"),
  );
  const [copyId, setCopyId] = useState(copyCandidates[0]?.id ?? "");
  const [copyMessage, setCopyMessage] = useState("");
  const [copyPending, startCopy] = useTransition();
  const router = useRouter();
  const active = useMemo(() => entries.find((entry) => entry.id === activeId), [activeId, entries]);
  useEffect(() => {
    if (activeId !== "new" && !entries.some((entry) => entry.id === activeId))
      setActiveId(entries[0]?.id ?? "new");
  }, [activeId, entries]);
  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        value={[activeId]}
        onValueChange={(value) => value[0] && setActiveId(value[0])}
        variant="outline"
        className="w-full flex-wrap justify-start"
      >
        <ToggleGroupItem value="new">
          <PlusIcon data-icon="inline-start" />
          新建
        </ToggleGroupItem>
        {entries.map((entry, index) => (
          <ToggleGroupItem key={entry.id} value={entry.id}>
            视频 {entries.length - index}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {active ? (
        <EditVideo
          projectId={projectId}
          entry={active}
          canReview={canReview}
          onDirtyChange={onDirtyChange}
        />
      ) : (
        <MarketingVideoCreateForm projectId={projectId} products={products} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>复制其他项目剪辑</CardTitle>
          <CardDescription>复制素材编排为独立草稿，不继承预览与审核状态。</CardDescription>
        </CardHeader>
        <CardContent>
          {copyCandidates.length ? (
            <Field>
              <FieldLabel>源剪辑</FieldLabel>
              <Select
                items={Object.fromEntries(
                  copyCandidates.map((item) => [
                    item.id,
                    item.projectTitle + " · " + item.productName + " · " + item.objective,
                  ]),
                )}
                value={copyId}
                onValueChange={(value) => value && setCopyId(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {copyCandidates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.projectTitle} · {item.productName} · {item.objective}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">其他项目暂无可复制剪辑。</p>
          )}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button
            variant="outline"
            disabled={copyPending || !copyId}
            onClick={() =>
              startCopy(async () => {
                const result = await copyMarketingVideoDraftAction(projectId, copyId);
                setCopyMessage(result.message);
                if (result.status === "success") router.refresh();
              })
            }
          >
            <CopyIcon data-icon="inline-start" />
            复制为新剪辑稿
          </Button>
          {copyMessage ? <p className="text-sm text-muted-foreground">{copyMessage}</p> : null}
        </CardFooter>
      </Card>
    </div>
  );
}
