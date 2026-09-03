"use client";

import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownIcon, ArrowUpIcon, BotIcon, CopyIcon, DownloadIcon, FilmIcon, PlusIcon, SaveIcon, ScissorsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { uploadPresigned } from "@vercel/blob/client";

import {
  createMarketingVideoDraftAction,
  copyMarketingVideoDraftAction,
  generateMarketingVideoAiDraftAction,
  renderMarketingVideoDraftAction,
  reviewMarketingVideoAction,
  saveMarketingVideoDraftAction,
} from "@/lib/actions/marketing-video";
import { initialMarketingVideoActionState } from "@/lib/action-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createMarketingVideoDraftFormSchema, marketingVideoDraftSchema, marketingVideoDurationMs, type MarketingVideoDraft } from "@/lib/video/edit-contracts";
import { maximumVideoUploadBatchBytes, shouldUseMultipartVideoUpload, videoPresignedUploadPayloadSchema, videoUploadBlobPath } from "@/lib/video/upload-contracts";
import type { MarketingVideoCopyCandidate, MarketingVideoEditorEntry, ReadyVideoProductSource } from "@/lib/video/store";
import { useWorkspaceDirty } from "./dirty-state";
import { MarketingVideoCreateForm } from "./marketing-video-create-form";

type CreateValues = z.infer<typeof createMarketingVideoDraftFormSchema>;

function stateLabel(state: string) {
  return ({ VIDEO_DRAFT: "编辑中", VIDEO_RENDERING: "合成中", VIDEO_REVIEW_REQUIRED: "待成片审核", VIDEO_REVISION_REQUIRED: "需要修改", VIDEO_APPROVED: "已通过" } as Record<string, string>)[state] ?? state;
}

function CreateVideoForm({ projectId, products }: { projectId: string; products: ReadyVideoProductSource[] }) {
  const router = useRouter();
  const filesRef = useRef<HTMLInputElement>(null);
  const uploadProgressRef = useRef<number[]>([]);
  const [hasFiles, setHasFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [state, action, pending] = useActionState(createMarketingVideoDraftAction, initialMarketingVideoActionState);
  const firstProduct = products[0];
  const form = useForm<CreateValues>({
    resolver: zodResolver(createMarketingVideoDraftFormSchema),
    defaultValues: { projectId, productId: firstProduct?.id ?? "", factPath: firstProduct?.factOptions[0]?.value ?? "", objective: "Create a concise product inquiry video", targetAudience: "Overseas automotive parts distributors", platform: "facebook", rightsEvidenceRef: "" },
  });
  useWorkspaceDirty("video-create", form.formState.isDirty || hasFiles);
  const selectedProductId = form.watch("productId");
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? firstProduct;
  useEffect(() => { if (state.status === "success") { form.reset(form.getValues()); if (filesRef.current) filesRef.current.value = ""; setHasFiles(false); router.refresh(); } }, [form, router, state.status]);
  async function submit(values: CreateValues) {
    const files = [...(filesRef.current?.files ?? [])];
    if (files.length < 1 || files.length > 3) { setUploadError("请选择 1–3 个营销素材。"); return; }
    if (files.reduce((total, file) => total + file.size, 0) > maximumVideoUploadBatchBytes) { setUploadError("一次素材总计必须小于 3GB。"); return; }
    setUploadError(""); setUploading(true); setUploadProgress(0); uploadProgressRef.current = files.map(() => 0);
    let receiptIds: string[];
    try {
      receiptIds = [];
      for (const [index, file] of files.entries()) {
        const receiptId = crypto.randomUUID();
        const payload = videoPresignedUploadPayloadSchema.parse({
          receiptId,
          projectId,
          originalFilename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          rightsEvidenceRef: values.rightsEvidenceRef,
        });
        await uploadPresigned(videoUploadBlobPath(payload), file, {
          access: "private",
          contentType: payload.contentType,
          handleUploadUrl: "/api/video-assets/upload",
          clientPayload: JSON.stringify(payload),
          multipart: shouldUseMultipartVideoUpload(payload.sizeBytes),
          onUploadProgress: ({ percentage }) => {
            uploadProgressRef.current[index] = percentage;
            setUploadProgress(uploadProgressRef.current.reduce((total, value) => total + value, 0) / files.length);
          },
        });
        receiptIds.push(receiptId);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "无法上传营销素材。");
      setUploading(false);
      return;
    }
    setUploading(false);
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    data.set("receiptIds", JSON.stringify(receiptIds));
    startTransition(() => action(data));
  }
  if (!products.length) return <Alert><AlertTitle>需要已核验产品</AlertTitle><AlertDescription>先在“产品资料”节点完成产品事实审核，再创建营销视频。</AlertDescription></Alert>;
  return <Card>
    <CardHeader><CardTitle>新建 15 秒剪辑</CardTitle><CardDescription>上传你有权使用的图片或视频；不会调用视频生成模型。</CardDescription></CardHeader>
    <CardContent><form id="create-marketing-video" onSubmit={form.handleSubmit(submit)}><FieldGroup>
      <Field data-invalid={Boolean(form.formState.errors.productId)}><FieldLabel>已核验产品</FieldLabel><Controller control={form.control} name="productId" render={({ field }) => <Select items={Object.fromEntries(products.map((product) => [product.id, product.productName + " · " + product.internalSku]))} value={field.value} onValueChange={(value) => { field.onChange(value); const product = products.find((item) => item.id === value); form.setValue("factPath", product?.factOptions[0]?.value ?? ""); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.productName} · {product.internalSku}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldError>{form.formState.errors.productId?.message}</FieldError></Field>
      <Field data-invalid={Boolean(form.formState.errors.factPath)}><FieldLabel>字幕可引用的事实</FieldLabel><Controller control={form.control} name="factPath" render={({ field }) => <Select items={Object.fromEntries((selectedProduct?.factOptions ?? []).map((fact) => [fact.value, fact.label]))} value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{selectedProduct?.factOptions.map((fact) => <SelectItem key={fact.value} value={fact.value}>{fact.label}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldError>{form.formState.errors.factPath?.message}</FieldError></Field>
      <Field data-invalid={Boolean(form.formState.errors.objective)}><FieldLabel htmlFor="video-objective">视频目标</FieldLabel><Input id="video-objective" aria-invalid={Boolean(form.formState.errors.objective)} {...form.register("objective")} /><FieldError>{form.formState.errors.objective?.message}</FieldError></Field>
      <Field data-invalid={Boolean(form.formState.errors.targetAudience)}><FieldLabel htmlFor="video-audience">目标受众</FieldLabel><Input id="video-audience" aria-invalid={Boolean(form.formState.errors.targetAudience)} {...form.register("targetAudience")} /><FieldError>{form.formState.errors.targetAudience?.message}</FieldError></Field>
      <Field><FieldLabel>输出平台</FieldLabel><Controller control={form.control} name="platform" render={({ field }) => <ToggleGroup value={[field.value]} onValueChange={(value) => value[0] && field.onChange(value[0])} variant="outline" className="flex-wrap"><ToggleGroupItem value="facebook">Facebook</ToggleGroupItem><ToggleGroupItem value="instagram">Instagram</ToggleGroupItem><ToggleGroupItem value="tiktok">TikTok</ToggleGroupItem><ToggleGroupItem value="youtube">YouTube</ToggleGroupItem><ToggleGroupItem value="x">X</ToggleGroupItem></ToggleGroup>} /></Field>
      <Field><FieldLabel htmlFor="video-assets">素材（1–3 个）</FieldLabel><Input ref={filesRef} id="video-assets" name="assets" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple required disabled={uploading || pending} onChange={(event) => { setHasFiles(Boolean(event.target.files?.length)); setUploadError(""); }} /><FieldDescription>素材以精确路径预签名 URL 顺序直传私有 Blob；超过 100MB 自动分片。图片不超过 20MB，视频必须小于 1GB，源视频最长 120 秒。</FieldDescription></Field>
      <Field data-invalid={Boolean(form.formState.errors.rightsEvidenceRef)}><FieldLabel htmlFor="video-rights">素材权利证据</FieldLabel><Input id="video-rights" placeholder="evidence-rights-001" aria-invalid={Boolean(form.formState.errors.rightsEvidenceRef)} {...form.register("rightsEvidenceRef")} /><FieldError>{form.formState.errors.rightsEvidenceRef?.message}</FieldError></Field>
      {uploading ? <Progress aria-label="素材上传进度" value={uploadProgress}><ProgressLabel>私有上传</ProgressLabel><ProgressValue>{() => `${Math.round(uploadProgress)}%`}</ProgressValue></Progress> : null}
    </FieldGroup></form></CardContent>
    <CardFooter className="flex-col items-stretch gap-3"><Button form="create-marketing-video" type="submit" disabled={pending || uploading}><PlusIcon data-icon="inline-start" />{uploading ? "正在直传素材…" : pending ? "正在创建剪辑稿…" : "上传并生成 AI 初稿"}</Button>{uploadError ? <p className="text-sm text-destructive" aria-live="polite">{uploadError}</p> : null}{state.message ? <p className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"} aria-live="polite">{state.message}</p> : null}</CardFooter>
  </Card>;
}

function ClipEditor({ draft, factOptions, onChange, disabled }: { draft: MarketingVideoDraft; factOptions: MarketingVideoEditorEntry["captionFactOptions"]; onChange: (draft: MarketingVideoDraft) => void; disabled: boolean }) {
  function patchClip(index: number, patch: Partial<MarketingVideoDraft["clips"][number]>) { onChange({ ...draft, clips: draft.clips.map((clip, clipIndex) => clipIndex === index ? { ...clip, ...patch } : clip) }); }
  function move(index: number, offset: -1 | 1) { const clips = [...draft.clips]; const target = index + offset; if (target < 0 || target >= clips.length) return; [clips[index], clips[target]] = [clips[target]!, clips[index]!]; onChange({ ...draft, clips }); }
  function changeCaptionKind(index: number, kind: "none" | "creative" | "verified_fact") {
    const current = draft.clips[index]!.caption;
    if (kind === "none") patchClip(index, { caption: { kind } });
    else if (kind === "creative") patchClip(index, { caption: { kind, text: current.kind === "creative" ? current.text : "" } });
    else if (factOptions[0]) patchClip(index, { caption: { kind, claimRef: current.kind === "verified_fact" ? current.claimRef : factOptions[0].field } });
  }
  return <FieldSet disabled={disabled}><FieldLegend>剪辑顺序</FieldLegend><div className="flex flex-col gap-3">{draft.clips.map((clip, index) => <Card key={clip.clipId}>
    <CardHeader className="flex-row items-start justify-between"><div className="flex flex-col gap-1"><CardTitle className="text-sm">片段 {index + 1}</CardTitle><CardDescription>{clip.mediaType === "image" ? "图片" : "视频"} · {clip.assetRef.slice(0, 20)}…</CardDescription></div><div className="flex gap-1"><Button type="button" size="icon-sm" variant="ghost" aria-label={`片段 ${index + 1} 上移`} disabled={index === 0 || disabled} onClick={() => move(index, -1)}><ArrowUpIcon /></Button><Button type="button" size="icon-sm" variant="ghost" aria-label={`片段 ${index + 1} 下移`} disabled={index === draft.clips.length - 1 || disabled} onClick={() => move(index, 1)}><ArrowDownIcon /></Button></div></CardHeader>
    <CardContent><FieldGroup>
      {clip.mediaType === "video" ? <Field><FieldLabel htmlFor={`${clip.clipId}-start`}>源素材起点（秒）</FieldLabel><Input id={`${clip.clipId}-start`} type="number" min="0" step="0.1" value={clip.trimStartMs / 1_000} onChange={(event) => patchClip(index, { trimStartMs: Math.max(0, Math.round(Number(event.target.value) * 1_000)) })} /></Field> : null}
      <Field><FieldLabel htmlFor={`${clip.clipId}-duration`}>成片时长（秒）</FieldLabel><Input id={`${clip.clipId}-duration`} type="number" min="1" max="10" step="0.1" value={clip.durationMs / 1_000} onChange={(event) => patchClip(index, { durationMs: Math.round(Number(event.target.value) * 1_000) })} /></Field>
      <Field><FieldLabel>画面适配</FieldLabel><ToggleGroup value={[clip.fitMode]} onValueChange={(value) => value[0] && patchClip(index, { fitMode: value[0] as "contain" | "cover" })} variant="outline"><ToggleGroupItem value="contain">完整显示</ToggleGroupItem><ToggleGroupItem value="cover">铺满裁切</ToggleGroupItem></ToggleGroup></Field>
      {clip.mediaType === "video" ? <Field><FieldLabel>声音</FieldLabel><ToggleGroup value={[clip.audioMode]} onValueChange={(value) => value[0] && patchClip(index, { audioMode: value[0] as "muted" | "source" })} variant="outline"><ToggleGroupItem value="muted">静音</ToggleGroupItem><ToggleGroupItem value="source">保留原声</ToggleGroupItem></ToggleGroup></Field> : null}
      <Field><FieldLabel htmlFor={`${clip.clipId}-caption-kind`}>字幕类型</FieldLabel><NativeSelect className="w-full" id={`${clip.clipId}-caption-kind`} value={clip.caption.kind} onChange={(event) => changeCaptionKind(index, event.target.value as "none" | "creative" | "verified_fact")}><NativeSelectOption value="none">无字幕</NativeSelectOption><NativeSelectOption value="creative">创意文案</NativeSelectOption><NativeSelectOption value="verified_fact">核验事实</NativeSelectOption></NativeSelect><FieldDescription>事实字幕由服务端读取当前 ProductReady 值，不能手工改写。</FieldDescription></Field>
      {clip.caption.kind === "creative" ? <Field><FieldLabel htmlFor={`${clip.clipId}-caption-text`}>创意字幕</FieldLabel><Textarea id={`${clip.clipId}-caption-text`} maxLength={120} value={clip.caption.text} onChange={(event) => patchClip(index, { caption: { kind: "creative", text: event.target.value } })} /><FieldDescription>仅写营销表达；工程和商业事实请使用“核验事实”。</FieldDescription></Field> : null}
      {clip.caption.kind === "verified_fact" ? <Field><FieldLabel htmlFor={`${clip.clipId}-caption-fact`}>事实字段</FieldLabel><NativeSelect className="w-full" id={`${clip.clipId}-caption-fact`} value={clip.caption.claimRef} onChange={(event) => patchClip(index, { caption: { kind: "verified_fact", claimRef: event.target.value } })}>{factOptions.map((fact) => <NativeSelectOption key={fact.field} value={fact.field}>{fact.field} · {fact.value}</NativeSelectOption>)}</NativeSelect><FieldDescription>成片使用服务端保存的核验值，不接受浏览器提交事实文字。</FieldDescription></Field> : null}
    </FieldGroup></CardContent>
  </Card>)}</div></FieldSet>;
}

function EditVideo({ projectId, entry, canReview, onDirtyChange }: { projectId: string; entry: MarketingVideoEditorEntry; canReview: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const router = useRouter(); const [pending, startAction] = useTransition(); const [draft, setDraft] = useState(entry.draft); const [message, setMessage] = useState(""); const [reviewEvidence, setReviewEvidence] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry.draft);
  const durationMs = marketingVideoDurationMs(draft); const editable = ["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(entry.state);
  const processing = entry.processingJob?.status === "queued" || entry.processingJob?.status === "running";
  useEffect(() => { setDraft(entry.draft); }, [entry.draft]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  useEffect(() => { if (!processing) return; const timer = window.setInterval(() => router.refresh(), 3_000); return () => window.clearInterval(timer); }, [processing, router]);
  function run(action: () => Promise<{ status: string; message: string }>) { startAction(async () => { const result = await action(); setMessage(result.message); if (result.status === "success") router.refresh(); }); }
  function validatedDraft() { const result = marketingVideoDraftSchema.safeParse(draft); if (!result.success) { setMessage(result.error.issues[0]?.message ?? "剪辑稿无效。"); return null; } return result.data; }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{stateLabel(entry.state)}</Badge>{processing ? <Badge>后台处理中</Badge> : null}<Badge variant="outline">{entry.draft.platform}</Badge><Badge variant="outline">最长 15 秒</Badge></div>
    <div><h3 className="font-medium">{entry.productName}</h3><p className="mt-1 text-sm text-muted-foreground">{entry.objective}</p></div>
    {entry.previewAssetRef ? <Card><CardHeader><CardTitle>私有预览</CardTitle><CardDescription>审核通过也不会自动发布。</CardDescription></CardHeader><CardContent><video className="aspect-video w-full rounded-lg bg-muted" controls preload="metadata" src={`/api/video-preview/${entry.previewAssetRef}`} /></CardContent>{entry.downloadAvailable ? <CardFooter><LinkButton className="w-full" href={`/api/video-download/${entry.id}`} download prefetch={false}><DownloadIcon data-icon="inline-start" />下载 MP4</LinkButton></CardFooter> : null}</Card> : null}
    {editable ? <>
      <Progress aria-label="视频总时长" value={Math.min(100, durationMs / 150)}><ProgressLabel>总时长</ProgressLabel><ProgressValue>{() => `${(durationMs / 1_000).toFixed(1)} / 15 秒`}</ProgressValue></Progress>
      {durationMs > 15_000 ? <Alert variant="destructive"><AlertTitle>视频过长</AlertTitle><AlertDescription>请缩短片段，总时长必须不超过 15 秒。</AlertDescription></Alert> : null}
      <ClipEditor draft={draft} factOptions={entry.captionFactOptions} onChange={setDraft} disabled={pending || processing} />
      <Separator />
      <Field><FieldLabel htmlFor="video-cta">最后两秒 CTA</FieldLabel><Input id="video-cta" maxLength={40} value={draft.ctaText} onChange={(event) => setDraft({ ...draft, ctaText: event.target.value })} /><FieldDescription>固定居中样式，不增加视频总时长。</FieldDescription></Field>
      <div className="grid gap-2 sm:grid-cols-3"><Button variant="outline" disabled={pending || processing} onClick={() => run(() => generateMarketingVideoAiDraftAction(projectId, entry.id))}><BotIcon data-icon="inline-start" />AI 初稿</Button><Button variant="outline" disabled={pending || processing || !dirty} onClick={() => { const value = validatedDraft(); if (value) run(() => saveMarketingVideoDraftAction(projectId, entry.id, value)); }}><SaveIcon data-icon="inline-start" />保存</Button><Button disabled={pending || processing || durationMs > 15_000} onClick={() => { const value = validatedDraft(); if (value) run(() => renderMarketingVideoDraftAction(projectId, entry.id, value)); }}><ScissorsIcon data-icon="inline-start" />合成预览</Button></div>
    </> : null}
    {entry.state === "VIDEO_RENDERING" ? <Alert><FilmIcon /><AlertTitle>正在合成</AlertTitle><AlertDescription>服务器正在生成私有预览，请稍后刷新。</AlertDescription></Alert> : null}
    {entry.processingJob?.status === "failed" ? <Alert variant="destructive"><AlertTitle>{entry.processingJob.kind === "render" ? "合成失败" : "AI 初稿失败"}</AlertTitle><AlertDescription>{entry.processingJob.failureMessage ?? "后台任务失败，请重试。"}</AlertDescription></Alert> : null}
    {entry.state === "VIDEO_REVIEW_REQUIRED" && canReview ? <Card><CardHeader><CardTitle>成片审核</CardTitle><CardDescription>核对画面、字幕、CTA 和产品事实后再决定。</CardDescription></CardHeader><CardContent><Field><FieldLabel htmlFor="video-review-evidence">审核证据</FieldLabel><Input id="video-review-evidence" placeholder="evidence-review-001" value={reviewEvidence} onChange={(event) => setReviewEvidence(event.target.value)} /></Field></CardContent><CardFooter className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={pending || !reviewEvidence} onClick={() => run(() => reviewMarketingVideoAction(projectId, entry.id, "rejected", reviewEvidence, "成片需要修改"))}>退回修改</Button><Button disabled={pending || !reviewEvidence} onClick={() => run(() => reviewMarketingVideoAction(projectId, entry.id, "approved", reviewEvidence, "成片已人工确认"))}>通过成片</Button></CardFooter></Card> : null}
    {message ? <p className="text-sm text-muted-foreground" aria-live="polite">{message}</p> : null}
  </div>;
}

export function MarketingVideoPanel({ projectId, products, entries, copyCandidates, canReview, selectedId, onDirtyChange }: { projectId: string; products: ReadyVideoProductSource[]; entries: MarketingVideoEditorEntry[]; copyCandidates: MarketingVideoCopyCandidate[]; canReview: boolean; selectedId?: string; onDirtyChange: (dirty: boolean) => void }) {
  const [activeId, setActiveId] = useState(selectedId && entries.some((entry) => entry.id === selectedId) ? selectedId : entries[0]?.id ?? "new");
  const [copyId, setCopyId] = useState(copyCandidates[0]?.id ?? ""); const [copyMessage, setCopyMessage] = useState(""); const [copyPending, startCopy] = useTransition(); const router = useRouter();
  const active = useMemo(() => entries.find((entry) => entry.id === activeId), [activeId, entries]);
  useEffect(() => { if (activeId !== "new" && !entries.some((entry) => entry.id === activeId)) setActiveId(entries[0]?.id ?? "new"); }, [activeId, entries]);
  return <div className="flex flex-col gap-4">
    <ToggleGroup value={[activeId]} onValueChange={(value) => value[0] && setActiveId(value[0])} variant="outline" className="w-full flex-wrap justify-start"><ToggleGroupItem value="new"><PlusIcon data-icon="inline-start" />新建</ToggleGroupItem>{entries.map((entry, index) => <ToggleGroupItem key={entry.id} value={entry.id}>视频 {entries.length - index}</ToggleGroupItem>)}</ToggleGroup>
    {active ? <EditVideo projectId={projectId} entry={active} canReview={canReview} onDirtyChange={onDirtyChange} /> : <MarketingVideoCreateForm projectId={projectId} products={products} />}
    <Card><CardHeader><CardTitle>复制其他项目剪辑</CardTitle><CardDescription>复制素材编排为独立草稿，不继承预览与审核状态。</CardDescription></CardHeader><CardContent>{copyCandidates.length ? <Field><FieldLabel>源剪辑</FieldLabel><Select items={Object.fromEntries(copyCandidates.map((item) => [item.id, item.projectTitle + " · " + item.productName + " · " + item.objective]))} value={copyId} onValueChange={(value) => value && setCopyId(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{copyCandidates.map((item) => <SelectItem key={item.id} value={item.id}>{item.projectTitle} · {item.productName} · {item.objective}</SelectItem>)}</SelectGroup></SelectContent></Select></Field> : <p className="text-sm text-muted-foreground">其他项目暂无可复制剪辑。</p>}</CardContent><CardFooter className="flex-col items-stretch gap-3"><Button variant="outline" disabled={copyPending || !copyId} onClick={() => startCopy(async () => { const result = await copyMarketingVideoDraftAction(projectId, copyId); setCopyMessage(result.message); if (result.status === "success") router.refresh(); })}><CopyIcon data-icon="inline-start" />复制为新剪辑稿</Button>{copyMessage ? <p className="text-sm text-muted-foreground">{copyMessage}</p> : null}</CardFooter></Card>
  </div>;
}
