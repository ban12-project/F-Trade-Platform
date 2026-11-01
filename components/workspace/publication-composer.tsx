"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitPublicationBatchAction } from "@/lib/actions/publication-batch";
import type { listFacebookMediaOptions } from "@/lib/social/facebook-media-store";
import {
  type PublicationBatchResult,
  publicationBatchSchema,
} from "@/lib/social/publication-batch-schema";
import type { PublicationCandidate, PublicationChannel } from "@/lib/social/publication-store";
import { publishingBlockers } from "@/lib/social/publishing-account-policy";
import { useWorkspaceDirty } from "./dirty-state";
import { WorkspaceLink } from "./workspace-link";

const selectionSchema = z.object({
  choice: z.string().min(1, "请选择已审核内容与素材。"),
  accounts: z.array(z.string()).min(1, "请选择发布账号。"),
});
const accountKey = (a: { channelRef: string; accountRef: string }) =>
  JSON.stringify([a.channelRef, a.accountRef]);
export type PublicationMediaOptions = Awaited<ReturnType<typeof listFacebookMediaOptions>>;
export function PublicationComposer({
  projectId,
  contentRef,
  text,
  media = [],
  accounts,
  retryTargets = [],
}: {
  projectId: string;
  contentRef: string;
  text?: PublicationCandidate;
  media?: PublicationMediaOptions;
  accounts: PublicationChannel[];
  retryTargets?: PublicationChannel[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const returnTo = `${pathname}${params.size ? `?${params}` : ""}`;
  const storageKey = `publication-draft-v2:${projectId}:${contentRef}`;
  const mediaKey = (m: PublicationMediaOptions[number]) =>
    JSON.stringify([m.mediaId, m.captionContentRef ?? ""]);
  const choices = [
    ...(text
      ? [
          {
            key: "text",
            label: "仅正文",
            preview: text.preview,
            version: text.contentVersion,
            content: {
              projectId,
              contentRef,
              format: "text" as const,
              previewDigest: text.previewDigest,
            },
          },
        ]
      : []),
    ...media.map((m) => ({
      key: mediaKey(m),
      label: m.label,
      preview: m.preview,
      version: m.contentVersion,
      content: {
        projectId,
        contentRef: m.contentRef,
        format: m.format,
        mediaId: m.mediaId,
        ...(m.captionContentRef ? { captionContentRef: m.captionContentRef } : {}),
        contentVersion: m.contentVersion,
        previewDigest: m.previewDigest,
      },
    })),
  ];
  const form = useForm<z.infer<typeof selectionSchema>>({
    resolver: zodResolver(selectionSchema),
    defaultValues: {
      choice: choices.length === 1 ? choices[0].key : text ? "text" : "",
      accounts: [],
    },
  });
  const choice = useWatch({ control: form.control, name: "choice" });
  const keys = useWatch({ control: form.control, name: "accounts" });
  const selected = choices.find((c) => c.key === choice);
  const targets = accounts.filter((a) => keys.includes(accountKey(a)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<PublicationBatchResult[]>([]);
  const [previewFailed, setPreviewFailed] = useState(false);
  const inFlight = useRef(false);
  const batch = useRef<{ fingerprint: string; id: string } | null>(null);
  useWorkspaceDirty(storageKey, form.formState.isDirty && !results.length);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      const parsed = selectionSchema.safeParse(saved?.selection);
      if (parsed.success) form.reset(parsed.data);
      if (saved?.batch?.id && saved?.batch?.fingerprint) batch.current = saved.batch;
    } catch {
      /* Optional draft persistence contains no authorization. */
    }
  }, [storageKey, form]);
  function remember() {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ selection: form.getValues(), batch: batch.current }),
      );
    } catch {}
  }
  const previewUrl =
    selected && "mediaId" in selected.content
      ? `/api/publication-preview?${new URLSearchParams({ projectId, contentRef: selected.content.contentRef, format: selected.content.format, mediaId: selected.content.mediaId, ...("captionContentRef" in selected.content && selected.content.captionContentRef ? { captionContentRef: selected.content.captionContentRef } : {}) })}`
      : "";
  const unavailable = targets.some(
    (a) => !a.ready || (selected?.content.format !== "text" && a.textOnly),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>预览并发布</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async () => {
            if (
              inFlight.current ||
              !selected ||
              keys.length !== targets.length ||
              unavailable ||
              results.length
            )
              return;
            inFlight.current = true;
            setBusy(true);
            setMessage("");
            const content = selected.content;
            const targetValues = targets.map(({ channelRef, accountRef }) => ({
              channelRef,
              accountRef,
            }));
            const fingerprint = JSON.stringify({
              content,
              targets: targetValues,
              audience: "Public",
            });
            if (batch.current?.fingerprint !== fingerprint)
              batch.current = { fingerprint, id: crypto.randomUUID() };
            remember();
            try {
              const input = publicationBatchSchema.parse({
                batchId: batch.current.id,
                audience: "Public",
                content,
                targets: targetValues,
              });
              const result = await submitPublicationBatchAction(input);
              if (result.ok) {
                setResults(result.results);
                setMessage("发布任务已提交，正在等待各账号的平台回执。");
                router.refresh();
              } else setMessage(result.message);
            } catch {
              setMessage(
                "网络未返回提交结果。可再次点击确认查询同一批次，系统不会重复创建发布任务。",
              );
            } finally {
              inFlight.current = false;
              setBusy(false);
            }
          })}
        >
          <Field>
            <FieldLabel htmlFor={`content-${contentRef}`}>正文与素材</FieldLabel>
            <NativeSelect
              id={`content-${contentRef}`}
              value={choice}
              disabled={!form.formState.isReady || busy || !!results.length}
              onChange={(e) => {
                form.setValue("choice", e.target.value, { shouldDirty: true });
                setPreviewFailed(false);
                remember();
              }}
            >
              <NativeSelectOption value="">请选择已审核内容与素材</NativeSelectOption>
              {choices.map((c) => (
                <NativeSelectOption key={c.key} value={c.key}>
                  {c.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={[form.formState.errors.choice]} />
            <p className="text-sm text-muted-foreground">
              当前执行器每帖支持一张图片或一个视频。多图、混合素材和多个视频暂不能无损发布，系统不会自动拆帖。
            </p>
          </Field>
          <Field>
            <FieldLabel>发布账号（可多选）</FieldLabel>
            {accounts.map((a) => {
              const key = accountKey(a);
              const recovery =
                (a.recoveryHref
                  ? `${a.recoveryHref}?returnTo=${encodeURIComponent(returnTo)}`
                  : undefined) ??
                `/workspace/settings?section=channels&returnTo=${encodeURIComponent(returnTo)}`;
              return (
                <div key={key} className="space-y-1 rounded-md border p-3">
                  <label
                    htmlFor={`target-${encodeURIComponent(key)}`}
                    className="flex items-center gap-2"
                  >
                    <Checkbox
                      id={`target-${encodeURIComponent(key)}`}
                      aria-label={`${a.platform} · ${a.name}`}
                      checked={keys.includes(key)}
                      disabled={!form.formState.isReady || busy || !!results.length}
                      onCheckedChange={(checked) => {
                        form.setValue(
                          "accounts",
                          checked ? [...keys, key] : keys.filter((k) => k !== key),
                          { shouldDirty: true },
                        );
                        remember();
                      }}
                    />
                    {a.platform} · {a.name} ·{" "}
                    {a.ready ? "可以发布" : publishingBlockers[a.blockers?.[0] ?? "binding"]}
                  </label>
                  {keys.includes(key) && selected?.content.format !== "text" && a.textOnly ? (
                    <p role="alert">
                      此账号的媒体发布适配尚未完成，系统不能验证附件。选择已保留；无需您核对页面选择器。
                    </p>
                  ) : null}
                  {!a.ready ? (
                    <WorkspaceLink className="text-sm underline" href={recovery}>
                      处理此账号 · 返回后继续发布
                    </WorkspaceLink>
                  ) : null}
                </div>
              );
            })}
            {keys.some((key) => !accounts.some((a) => accountKey(a) === key)) ? (
              <p role="alert">某个已选账号已移除。本次不会提交，请重新选择账号。</p>
            ) : null}
            {!accounts.length ? (
              <WorkspaceLink
                href={`/workspace/settings?section=channels&returnTo=${encodeURIComponent(returnTo)}`}
              >
                添加发布账号
              </WorkspaceLink>
            ) : null}
            <FieldError errors={[form.formState.errors.accounts]} />
          </Field>
          {selected ? (
            <Alert>
              <AlertTitle>本次发布预览 · 版本 {selected.version ?? "已审核"}</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">
                <p>{selected.preview}</p>
                <p>范围：公开（所有人）</p>
                <p>
                  账号：{targets.map((a) => `${a.platform} · ${a.name}`).join("、") || "尚未选择"}
                </p>
                <p>
                  共 {keys.length} 条帖子，每个账号一条；形式：
                  {selected.content.format === "text"
                    ? "文字"
                    : selected.content.format === "image"
                      ? "图文"
                      : "视频＋正文（按页面流程发布视频或 Reels）"}
                  。
                </p>
              </AlertDescription>
            </Alert>
          ) : null}
          {previewUrl ? (
            selected?.content.format === "video" ? (
              <video
                key={previewUrl}
                controls
                preload="metadata"
                className="max-h-80 w-full"
                src={previewUrl}
                onError={() => setPreviewFailed(true)}
              >
                <track kind="captions" />
              </video>
            ) : (
              <img
                key={previewUrl}
                src={previewUrl}
                alt="本次发布图片"
                className="max-h-80 max-w-full object-contain"
                onError={() => setPreviewFailed(true)}
              />
            )
          ) : null}
          {previewFailed ? <p role="alert">素材预览加载失败，请重新加载预览后再确认。</p> : null}
          <Button
            type="submit"
            disabled={
              busy ||
              !!results.length ||
              !selected ||
              !keys.length ||
              unavailable ||
              previewFailed ||
              keys.length !== targets.length
            }
          >
            {busy ? "正在提交…" : `确认公开发布到 ${keys.length} 个账号`}
          </Button>
          <p role="status">{message}</p>
          {retryTargets.length ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                form.setValue("accounts", retryTargets.map(accountKey), { shouldDirty: true });
                batch.current = null;
                setResults([]);
                setMessage(
                  "已仅选择可安全重试的失败目标。成功或结果不确定的账号不会重试，请预览后确认。",
                );
                remember();
              }}
            >
              仅重新预览可安全重试的失败账号
            </Button>
          ) : null}
          {results.map((r) => (
            <p key={r.publicationId}>
              <WorkspaceLink
                className="underline"
                href={`/workspace/${projectId}/records/publication/${r.publicationId}`}
              >
                {accounts.find((a) => accountKey(a) === accountKey(r))?.name ?? "所选账号"}
                ：查看执行状态与回执
              </WorkspaceLink>
            </p>
          ))}
        </form>
      </CardContent>
    </Card>
  );
}
