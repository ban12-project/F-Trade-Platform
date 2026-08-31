"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ClapperboardIcon, PlusIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createVideoProjectFromCanvasAction, saveVideoCanvasAction } from "@/lib/actions/video";
import { decideVideoReviewAction, initialVideoReviewActionState } from "@/lib/actions/video-review";
import { videoReviewFormSchema } from "@/lib/form-schemas";
import { videoCanvasDocumentSchema, type VideoCanvasDocument, type VideoCanvasScene } from "@/lib/video/canvas-contracts";
import type { ReadyVideoProductSource, VideoWorkspaceEntry } from "@/lib/video/store";

const platforms = ["youtube", "tiktok", "instagram", "facebook", "x"] as const;
const platformLabels: Record<(typeof platforms)[number], string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", x: "X" };
const guidedVideoFormSchema = z.object({
  productId: z.string().min(1, "请选择已核验产品"),
  factPath: z.string().min(1, "请选择引用字段"),
  objective: z.string().trim().min(1, "请填写营销目标"),
  targetAudience: z.string().trim().min(1, "请填写目标受众"),
  assetRef: z.string().trim().min(1, "请填写私有素材引用"),
  rightsEvidenceRef: z.string().trim().min(1, "请填写权利证据引用"),
  platforms: z.array(z.enum(platforms)).min(1, "请至少选择一个目标平台"),
  scenes: z.record(z.string(), z.object({ prompt: z.string().trim().min(1, "请填写镜头说明"), durationSeconds: z.number().int().min(1).max(30) })).refine((scenes) => Object.keys(scenes).length > 0, "请至少添加一个镜头"),
});
type GuidedVideoFormValues = z.infer<typeof guidedVideoFormSchema>;

function initialDocument(): VideoCanvasDocument {
  return {
    version: 1,
    nodes: [
      { id: "brief", type: "studio", position: { x: 0, y: 80 }, deletable: false, data: { label: "营销简报\n目标与受众" } },
      { id: "facts", type: "studio", position: { x: 280, y: 0 }, deletable: false, data: { label: "已验证事实\n只读证据引用" } },
      { id: "assets", type: "studio", position: { x: 280, y: 160 }, deletable: false, data: { label: "私有素材\n权利证据" } },
      { id: "generate", type: "studio", position: { x: 560, y: 80 }, deletable: false, data: { label: "生成视频\n模型与参数" } },
    ],
    edges: [
      { id: "brief-facts", source: "brief", target: "facts" },
      { id: "facts-generate", source: "facts", target: "generate" },
      { id: "assets-generate", source: "assets", target: "generate" },
    ],
  };
}

function sceneIds(document: VideoCanvasDocument) {
  return document.nodes.filter((node) => node.id.startsWith("scene-")).map((node) => node.id);
}

function formValues(document: VideoCanvasDocument): GuidedVideoFormValues {
  return {
    productId: document.factBinding?.productId ?? "",
    factPath: document.factBinding?.factPath ?? "",
    objective: document.brief?.objective ?? "",
    targetAudience: document.brief?.targetAudience ?? "",
    assetRef: document.assetBinding?.assetRef ?? "",
    rightsEvidenceRef: document.assetBinding?.rightsEvidenceRef ?? "",
    platforms: document.platforms ?? [],
    scenes: Object.fromEntries(sceneIds(document).map((id) => [id, { prompt: document.scenes?.[id]?.prompt ?? "", durationSeconds: document.scenes?.[id]?.durationSeconds ?? 5 }])),
  };
}

function VideoReviewQueue({ entries }: { entries: VideoWorkspaceEntry[] }) {
  const pendingEntries = entries.filter((entry) => entry.state === "VIDEO_REVIEW_REQUIRED" && entry.approvalStatus === "pending");
  const [state, action, pending] = useActionState(decideVideoReviewAction, initialVideoReviewActionState);
  const form = useForm<z.infer<typeof videoReviewFormSchema>>({ resolver: zodResolver(videoReviewFormSchema), defaultValues: { videoId: pendingEntries[0]?.id ?? "", decision: "approved", evidenceRef: "", notes: "" } });
  const firstPendingVideoId = pendingEntries[0]?.id ?? "";
  useEffect(() => { form.setValue("videoId", firstPendingVideoId); }, [form, firstPendingVideoId]);
  if (!pendingEntries.length) return null;
  function submit(values: z.infer<typeof videoReviewFormSchema>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, String(value)); action(data); }
  return <Card><CardHeader><CardTitle>待人工确认</CardTitle><CardDescription>批准只允许进入已确认状态；不会启动生成或发布。</CardDescription></CardHeader><CardContent><form autoComplete="off" onSubmit={form.handleSubmit(submit)}><FieldGroup><Field><FieldLabel htmlFor="video-review-target">视频计划</FieldLabel><Controller control={form.control} name="videoId" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="video-review-target" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{pendingEntries.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.productName}</SelectItem>)}</SelectGroup></SelectContent></Select>} /></Field><Field><FieldLabel htmlFor="video-review-decision">决定</FieldLabel><Controller control={form.control} name="decision" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="video-review-decision" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="approved">批准：通过事实确认</SelectItem><SelectItem value="rejected">退回：要求修订</SelectItem></SelectGroup></SelectContent></Select>} /></Field><Field data-invalid={!!form.formState.errors.evidenceRef}><FieldLabel htmlFor="video-review-evidence">审核证据引用</FieldLabel><Input id="video-review-evidence" aria-invalid={!!form.formState.errors.evidenceRef} {...form.register("evidenceRef")} /><FieldError errors={[form.formState.errors.evidenceRef]} /></Field><Field><FieldLabel htmlFor="video-review-notes">审核备注</FieldLabel><Textarea id="video-review-notes" {...form.register("notes")} /></Field><Button type="submit" disabled={pending}>{pending ? "正在保存…" : "提交人工决定"}</Button></FieldGroup></form>{state.status !== "idle" ? <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">{state.message}</p> : null}</CardContent></Card>;
}

export function GuidedVideoWorkspace({ products, entries, initialCanvas, canReview }: {
  products: ReadyVideoProductSource[];
  entries: VideoWorkspaceEntry[];
  initialCanvas: { document: VideoCanvasDocument; revision: number } | null;
  canReview: boolean;
}) {
  const [document, setDocument] = useState<VideoCanvasDocument>(() => initialCanvas?.document ?? initialDocument());
  const form = useForm<GuidedVideoFormValues>({ resolver: zodResolver(guidedVideoFormSchema), mode: "onChange", defaultValues: formValues(initialCanvas?.document ?? initialDocument()) });
  const [revision, setRevision] = useState(initialCanvas?.revision ?? 0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "conflict">(initialCanvas ? "saved" : "saving");
  const [notice, setNotice] = useState("");
  const [submitting, startSubmit] = useTransition();
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedProduct = products.find((product) => product.id === document.factBinding?.productId);
  const ids = sceneIds(document);
  const completion = [document.factBinding, document.brief, document.assetBinding, document.platforms?.length, ids.length > 0 && ids.every((id) => document.scenes?.[id])].filter(Boolean).length;
  const issues = useMemo(() => {
    const result: string[] = [];
    if (!document.factBinding) result.push("选择已核验的产品字段");
    if (!document.brief?.objective || !document.brief.targetAudience) result.push("填写营销目标和受众");
    if (!document.assetBinding?.assetRef || !document.assetBinding.rightsEvidenceRef) result.push("填写素材和权利证据引用");
    if (!document.platforms?.length) result.push("选择目标平台");
    if (!ids.length) result.push("添加至少一个镜头");
    if (ids.some((id) => !document.scenes?.[id]?.prompt)) result.push("补全每个镜头的说明");
    return result;
  }, [document, ids]);

  useEffect(() => {
    if (pendingSave.current) clearTimeout(pendingSave.current);
    setSaveState("saving");
    pendingSave.current = setTimeout(async () => {
      const result = await saveVideoCanvasAction({ expectedRevision: revision, document });
      if (result.status === "success" && result.revision) {
        setRevision(result.revision);
        setSaveState("saved");
      } else {
        setSaveState(result.status === "conflict" ? "conflict" : "error");
        setNotice(result.message);
      }
    }, 700);
    return () => { if (pendingSave.current) clearTimeout(pendingSave.current); };
  }, [document]); // revision is advanced only by the request created for this document.

  function update(updater: (current: VideoCanvasDocument) => VideoCanvasDocument) {
    setDocument((current) => videoCanvasDocumentSchema.parse(updater(current)));
  }
  function updateBrief(key: "objective" | "targetAudience", value: string) {
    form.setValue(key, value, { shouldValidate: true, shouldDirty: true });
    update((current) => ({ ...current, brief: { objective: current.brief?.objective ?? "", targetAudience: current.brief?.targetAudience ?? "", [key]: value } }));
  }
  function addScene() {
    const id = `scene-${crypto.randomUUID()}`;
    form.setValue(`scenes.${id}`, { prompt: "", durationSeconds: 5 }, { shouldValidate: true });
    update((current) => ({ ...current, nodes: [...current.nodes, { id, type: "studio", position: { x: 280, y: 300 + current.nodes.length * 24 }, data: { label: "镜头\n待填写" } }], edges: [...current.edges, { id: `${id}-generate`, source: id, target: "generate" }], scenes: { ...current.scenes, [id]: { prompt: "", durationSeconds: 5 } } }));
  }
  function updateScene(id: string, patch: Partial<VideoCanvasScene>) {
    if (patch.prompt !== undefined) form.setValue(`scenes.${id}.prompt`, patch.prompt, { shouldValidate: true, shouldDirty: true });
    if (patch.durationSeconds !== undefined) form.setValue(`scenes.${id}.durationSeconds`, patch.durationSeconds, { shouldValidate: true, shouldDirty: true });
    update((current) => ({ ...current, scenes: { ...current.scenes, [id]: { prompt: "", durationSeconds: 5, ...current.scenes?.[id], ...patch } }, nodes: current.nodes.map((node) => node.id === id ? { ...node, data: { label: `镜头\n${(patch.prompt ?? current.scenes?.[id]?.prompt ?? "待填写").slice(0, 72)}` } } : node) }));
  }
  function moveScene(id: string, direction: -1 | 1) {
    const ordered = sceneIds(document); const index = ordered.indexOf(id); const next = index + direction;
    if (next < 0 || next >= ordered.length) return;
    const order = [...ordered]; [order[index], order[next]] = [order[next]!, order[index]!];
    update((current) => ({ ...current, nodes: [...current.nodes.filter((node) => !node.id.startsWith("scene-")), ...order.map((sceneId, position) => ({ ...current.nodes.find((node) => node.id === sceneId)!, position: { x: 280, y: 300 + position * 112 } }))] }));
  }
  function submit() {
    const parsed = videoCanvasDocumentSchema.safeParse(document);
    if (!parsed.success || issues.length) { setNotice(issues[0] ?? (!parsed.success ? parsed.error.issues[0]?.message : undefined) ?? "请完成必填项目。"); return; }
    startSubmit(async () => { const result = await createVideoProjectFromCanvasAction(parsed.data); setNotice(result.message); });
  }

  return <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:p-8">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-2"><div className="flex flex-wrap gap-2"><Badge variant="secondary">营销内容 · 视频</Badge><Badge variant="outline">逐步创建</Badge></div><h1 className="text-3xl font-semibold tracking-tight text-balance">创建待审视频计划</h1><p className="max-w-3xl text-muted-foreground text-pretty">按顺序完成产品事实、创意、素材和镜头。平台只会创建待人工确认的项目，不会自动生成或发布视频。</p></div>
      <LinkButton variant="outline" href="/studio"><SparklesIcon data-icon="inline-start" />打开高级画布</LinkButton>
    </header>
    <Card><CardHeader className="gap-3"><div className="flex items-center justify-between gap-4"><CardTitle>完成进度</CardTitle><Badge variant={saveState === "saved" ? "secondary" : "outline"}>{saveState === "saved" ? "草稿已保存" : saveState === "saving" ? "正在保存" : saveState === "conflict" ? "版本冲突" : "保存失败"}</Badge></div><Progress value={completion * 20}><ProgressLabel>视频计划</ProgressLabel><ProgressValue>{() => `${completion}/5`}</ProgressValue></Progress></CardHeader></Card>
    {notice ? <Alert variant={saveState === "error" || saveState === "conflict" ? "destructive" : "default"}><AlertTitle>{saveState === "error" || saveState === "conflict" ? "需要处理" : "提示"}</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="flex flex-col gap-6">
      <Card><CardHeader><CardTitle>1. 已核验产品与事实</CardTitle><CardDescription>只能选择已通过人工确认的产品字段。</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="video-product">产品</FieldLabel><Select value={document.factBinding?.productId ?? ""} onValueChange={(productId) => { if (!productId) return; const product = products.find((item) => item.id === productId); if (product?.factOptions[0]) { form.setValue("productId", productId, { shouldValidate: true, shouldDirty: true }); form.setValue("factPath", product.factOptions[0].value, { shouldValidate: true, shouldDirty: true }); update((current) => ({ ...current, factBinding: { productId, factPath: product.factOptions[0]!.value } })); } }}><SelectTrigger id="video-product" className="w-full"><SelectValue placeholder="选择已核验产品" /></SelectTrigger><SelectContent><SelectGroup>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.internalSku} · {product.productName}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="video-fact">引用字段</FieldLabel><Select value={document.factBinding?.factPath ?? ""} onValueChange={(factPath) => { if (factPath && document.factBinding) { form.setValue("factPath", factPath, { shouldValidate: true, shouldDirty: true }); update((current) => ({ ...current, factBinding: { ...current.factBinding!, factPath } })); } }} disabled={!selectedProduct}><SelectTrigger id="video-fact" className="w-full"><SelectValue placeholder="先选择产品" /></SelectTrigger><SelectContent><SelectGroup>{selectedProduct?.factOptions.map((fact) => <SelectItem key={fact.value} value={fact.value}>{fact.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></FieldGroup></CardContent></Card>
      <Card><CardHeader><CardTitle>2. 营销简报</CardTitle><CardDescription>创意内容不能补充未绑定的工程或商业事实。</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="video-objective">营销目标</FieldLabel><Input id="video-objective" value={document.brief?.objective ?? ""} onChange={(event) => updateBrief("objective", event.target.value)} /></Field><Field><FieldLabel htmlFor="video-audience">目标受众</FieldLabel><Input id="video-audience" value={document.brief?.targetAudience ?? ""} onChange={(event) => updateBrief("targetAudience", event.target.value)} /></Field></FieldGroup></CardContent></Card>
      <Card><CardHeader><CardTitle>3. 素材与权利</CardTitle><CardDescription>仅填写受控私有引用；不要输入公开链接或本地路径。</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="video-asset">私有素材引用</FieldLabel><Input id="video-asset" placeholder="asset-product-001" value={document.assetBinding?.assetRef ?? ""} onChange={(event) => { form.setValue("assetRef", event.target.value, { shouldValidate: true, shouldDirty: true }); update((current) => ({ ...current, assetBinding: { assetRef: event.target.value, rightsEvidenceRef: current.assetBinding?.rightsEvidenceRef ?? "" } })); }} /></Field><Field><FieldLabel htmlFor="video-rights">权利证据引用</FieldLabel><Input id="video-rights" placeholder="evidence-rights-001" value={document.assetBinding?.rightsEvidenceRef ?? ""} onChange={(event) => { form.setValue("rightsEvidenceRef", event.target.value, { shouldValidate: true, shouldDirty: true }); update((current) => ({ ...current, assetBinding: { assetRef: current.assetBinding?.assetRef ?? "", rightsEvidenceRef: event.target.value } })); }} /></Field></FieldGroup></CardContent></Card>
      <Card><CardHeader className="flex-row items-center justify-between gap-4"><div><CardTitle>4. 镜头故事板</CardTitle><CardDescription>用按钮调整顺序，所有核心步骤都可键盘操作。</CardDescription></div><Button type="button" onClick={addScene}><PlusIcon data-icon="inline-start" />添加镜头</Button></CardHeader><CardContent className="flex flex-col gap-4">{ids.length === 0 ? <Alert><AlertTitle>尚未添加镜头</AlertTitle><AlertDescription>至少需要一个镜头才能提交审核。</AlertDescription></Alert> : ids.map((id, index) => <Card key={id} className="gap-3"><CardHeader className="flex-row items-center justify-between gap-3 py-4"><CardTitle className="text-base">镜头 {index + 1}</CardTitle><div className="flex gap-2"><Button type="button" size="icon" variant="outline" aria-label="上移镜头" disabled={index === 0} onClick={() => moveScene(id, -1)}><ArrowUpIcon /></Button><Button type="button" size="icon" variant="outline" aria-label="下移镜头" disabled={index === ids.length - 1} onClick={() => moveScene(id, 1)}><ArrowDownIcon /></Button></div></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor={`${id}-prompt`}>镜头说明</FieldLabel><Textarea id={`${id}-prompt`} value={document.scenes?.[id]?.prompt ?? ""} onChange={(event) => updateScene(id, { prompt: event.target.value })} /></Field><Field><FieldLabel htmlFor={`${id}-duration`}>时长（秒）</FieldLabel><Input id={`${id}-duration`} type="number" min={1} max={30} value={document.scenes?.[id]?.durationSeconds ?? 5} onChange={(event) => updateScene(id, { durationSeconds: Number(event.target.value) || 1 })} /></Field></FieldGroup></CardContent></Card>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>5. 目标平台</CardTitle><CardDescription>这是项目意图，不会触发任何对外发布。</CardDescription></CardHeader><CardContent><ToggleGroup value={document.platforms ?? []} onValueChange={(value) => { form.setValue("platforms", value as GuidedVideoFormValues["platforms"], { shouldValidate: true, shouldDirty: true }); update((current) => ({ ...current, platforms: value as VideoCanvasDocument["platforms"] })); }} multiple variant="outline" spacing={2}>{platforms.map((platform) => <ToggleGroupItem key={platform} value={platform}>{platformLabels[platform]}</ToggleGroupItem>)}</ToggleGroup></CardContent></Card>
    </div><aside className="flex flex-col gap-4"><Card><CardHeader><CardTitle>提交前检查</CardTitle><CardDescription>完成后将进入管理员人工确认队列。</CardDescription></CardHeader><CardContent><ul className="flex flex-col gap-3 text-sm">{issues.length ? issues.map((issue) => <li key={issue} className="text-muted-foreground">• {issue}</li>) : <li className="flex items-center gap-2"><CheckIcon aria-hidden="true" />可以提交审核</li>}</ul><Button className="mt-5 w-full" disabled={submitting || issues.length > 0} onClick={() => void form.handleSubmit(submit, () => setNotice("请完成必填项目后再提交。"))()}>{submitting ? "正在创建…" : "提交人工确认"}</Button></CardContent></Card>{canReview ? <VideoReviewQueue entries={entries} /> : null}<Card><CardHeader><CardTitle>最近视频项目</CardTitle></CardHeader><CardContent>{entries.length ? <ul className="flex flex-col gap-3 text-sm">{entries.slice(0, 5).map((entry) => <li key={entry.id}><p className="font-medium">{entry.productName}</p><p className="text-muted-foreground">{entry.state === "VIDEO_REVIEW_REQUIRED" ? "等待人工确认" : entry.state}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">尚无视频项目。</p>}</CardContent></Card></aside></div>
  </div>;
}
