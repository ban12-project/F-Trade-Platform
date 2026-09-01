"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, MailPlusIcon, SaveIcon, Settings2Icon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { saveProductAgentModelSettingsAction } from "@/lib/actions/agent-settings";
import { createInvitationAction } from "@/lib/actions/invitations";
import { saveSocialChannelControlAction } from "@/lib/actions/social-controls";
import { initialAgentSettingsActionState, initialInvitationActionState, initialSocialControlActionState } from "@/lib/action-states";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { authClient } from "@/lib/auth-client";
import { invitationFormSchema, productAgentModelSettingsSchema } from "@/lib/form-schemas";

type AgentValues = z.infer<typeof productAgentModelSettingsSchema>;
const socialSchema = z.object({ channelRef: z.string().trim().min(1, "需要渠道引用。"), accountRef: z.string().trim().min(1, "需要账户引用。"), action: z.enum(["enable", "pause", "resume"]), evidenceRef: z.string().trim().min(1, "需要脱敏证据引用。") });
type SocialValues = z.infer<typeof socialSchema>;
const fallbackSettings: ProductAgentModelSettings = { provider: "openai", model: "gpt-5-mini", baseUrl: "", headersJson: "{}", providerName: "", organization: "", project: "", apiKeyConfigured: false, authTokenConfigured: false, source: "unconfigured" };

function AgentSettings({ settings }: { settings: ProductAgentModelSettings }) {
  const [state, action, pending] = useActionState(saveProductAgentModelSettingsAction, initialAgentSettingsActionState);
  const form = useForm<AgentValues>({ resolver: zodResolver(productAgentModelSettingsSchema), defaultValues: { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, headersJson: settings.headersJson, providerName: settings.providerName, organization: settings.organization, project: settings.project, apiKey: "", authToken: "", clearApiKey: false, clearAuthToken: false } });
  function submit(values: AgentValues) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, String(value)); startTransition(() => action(data)); }
  return <Card><CardHeader><CardTitle>Product Agent</CardTitle><CardDescription>密钥只在服务端加密保存；视频生成模型不在此处配置。</CardDescription></CardHeader><CardContent><form id="agent-settings" onSubmit={form.handleSubmit(submit)}><FieldGroup><Field><FieldLabel>Provider</FieldLabel><Controller control={form.control} name="provider" render={({ field }) => <Select items={{ openai: "OpenAI", anthropic: "Anthropic", google: "Google Gemini", "openai-compatible": "OpenAI-compatible" }} value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="google">Google Gemini</SelectItem><SelectItem value="openai-compatible">OpenAI-compatible</SelectItem></SelectGroup></SelectContent></Select>} /></Field><Field data-invalid={!!form.formState.errors.model}><FieldLabel htmlFor="agent-model">模型</FieldLabel><Input id="agent-model" {...form.register("model")} /><FieldError errors={[form.formState.errors.model]} /></Field><Field data-invalid={!!form.formState.errors.baseUrl}><FieldLabel htmlFor="agent-base-url">Base URL</FieldLabel><Input id="agent-base-url" inputMode="url" placeholder="官方端点可留空" {...form.register("baseUrl")} /><FieldError errors={[form.formState.errors.baseUrl]} /></Field><Field><FieldLabel htmlFor="agent-api-key">API key {settings.apiKeyConfigured ? "（已配置）" : ""}</FieldLabel><Input id="agent-api-key" type="password" autoComplete="new-password" {...form.register("apiKey")} /></Field><Field><FieldLabel htmlFor="agent-auth-token">Auth token {settings.authTokenConfigured ? "（已配置）" : ""}</FieldLabel><Input id="agent-auth-token" type="password" autoComplete="new-password" {...form.register("authToken")} /></Field><Field orientation="horizontal"><Controller control={form.control} name="clearApiKey" render={({ field }) => <Checkbox id="clear-agent-key" checked={field.value} onCheckedChange={field.onChange} />} /><FieldLabel htmlFor="clear-agent-key">清除已有 API key</FieldLabel></Field><Field orientation="horizontal"><Controller control={form.control} name="clearAuthToken" render={({ field }) => <Checkbox id="clear-agent-token" checked={field.value} onCheckedChange={field.onChange} />} /><FieldLabel htmlFor="clear-agent-token">清除已有 Auth token</FieldLabel></Field><Field data-invalid={!!form.formState.errors.headersJson}><FieldLabel htmlFor="agent-headers">自定义 Headers（JSON）</FieldLabel><Textarea id="agent-headers" rows={4} spellCheck={false} {...form.register("headersJson")} /><FieldDescription>不能在这里保存认证 Header。</FieldDescription><FieldError errors={[form.formState.errors.headersJson]} /></Field></FieldGroup></form></CardContent><CardFooter className="flex-col items-stretch gap-3"><Button form="agent-settings" type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}保存 Agent 配置</Button>{state.message ? <p className="text-sm text-muted-foreground" aria-live="polite">{state.message}</p> : null}</CardFooter></Card>;
}

function TeamSettings() {
  const [state, action, pending] = useActionState(createInvitationAction, initialInvitationActionState); const form = useForm<z.infer<typeof invitationFormSchema>>({ resolver: zodResolver(invitationFormSchema), defaultValues: { email: "" } });
  useEffect(() => { if (state.status === "success") form.reset(); }, [form, state.status]);
  function submit(values: z.infer<typeof invitationFormSchema>) { const data = new FormData(); data.set("email", values.email); startTransition(() => action(data)); }
  return <Card><CardHeader><CardTitle>邀请用户</CardTitle><CardDescription>单次、限时邀请；不开放公开注册。</CardDescription></CardHeader><CardContent><form id="invite-user" onSubmit={form.handleSubmit(submit)}><FieldGroup><Field data-invalid={!!form.formState.errors.email}><FieldLabel htmlFor="invite-email">受邀邮箱</FieldLabel><Input id="invite-email" type="email" autoComplete="email" {...form.register("email")} /><FieldError errors={[form.formState.errors.email]} /></Field></FieldGroup></form></CardContent><CardFooter className="flex-col items-stretch gap-3"><Button form="invite-user" type="submit" disabled={pending}><MailPlusIcon data-icon="inline-start" />发送邀请</Button>{state.message ? <p className="text-sm text-muted-foreground" aria-live="polite">{state.message}</p> : null}</CardFooter></Card>;
}

function SecuritySettings() {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function addPasskey() { setBusy(true); try { const { error } = await authClient.passkey.addPasskey({ name: "F-Trade Passkey" }); setMessage(error?.message ?? "Passkey 已添加。下次可以使用当前设备安全登录。"); } catch { setMessage("无法添加 Passkey，请确认设备支持后重试。"); } finally { setBusy(false); } }
  return <Card><CardHeader><CardTitle>Passkey</CardTitle><CardDescription>使用指纹、面容或设备解锁方式登录，不在应用中保存密码。</CardDescription></CardHeader><CardContent><p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">{message}</p></CardContent><CardFooter><Button className="w-full" disabled={busy} onClick={addPasskey}>{busy ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}添加当前设备</Button></CardFooter></Card>;
}

function ChannelSettings() {
  const [state, action, pending] = useActionState(saveSocialChannelControlAction, initialSocialControlActionState); const form = useForm<SocialValues>({ resolver: zodResolver(socialSchema), defaultValues: { channelRef: "", accountRef: "", action: "pause", evidenceRef: "" } });
  function submit(values: SocialValues) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); startTransition(() => action(data)); }
  return <div className="flex flex-col gap-4"><Alert variant="destructive"><ShieldAlertIcon /><AlertTitle>失败闭合</AlertTitle><AlertDescription>验证码、2FA、登录失效或结果不确定时必须暂停，不能自动重试。</AlertDescription></Alert><Card><CardHeader><CardTitle>社交渠道控制</CardTitle><CardDescription>启用或恢复不会绕过 Gate 01 和逐帖人工确认。</CardDescription></CardHeader><CardContent><form id="channel-settings" onSubmit={form.handleSubmit(submit)}><FieldGroup><Field data-invalid={!!form.formState.errors.channelRef}><FieldLabel htmlFor="channel-ref">渠道引用</FieldLabel><Input id="channel-ref" {...form.register("channelRef")} /><FieldError errors={[form.formState.errors.channelRef]} /></Field><Field data-invalid={!!form.formState.errors.accountRef}><FieldLabel htmlFor="account-ref">账户引用</FieldLabel><Input id="account-ref" {...form.register("accountRef")} /><FieldError errors={[form.formState.errors.accountRef]} /></Field><Field><FieldLabel>操作</FieldLabel><Controller control={form.control} name="action" render={({ field }) => <Select items={{ enable: "启用", pause: "暂停", resume: "人工恢复" }} value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="enable">启用</SelectItem><SelectItem value="pause">暂停</SelectItem><SelectItem value="resume">人工恢复</SelectItem></SelectGroup></SelectContent></Select>} /></Field><Field data-invalid={!!form.formState.errors.evidenceRef}><FieldLabel htmlFor="channel-evidence">脱敏证据</FieldLabel><Input id="channel-evidence" {...form.register("evidenceRef")} /><FieldError errors={[form.formState.errors.evidenceRef]} /></Field></FieldGroup></form></CardContent><CardFooter className="flex-col items-stretch gap-3"><Button form="channel-settings" type="submit" disabled={pending}>保存控制状态</Button>{state.message ? <p className="text-sm text-muted-foreground" aria-live="polite">{state.message}</p> : null}</CardFooter></Card></div>;
}

export function WorkspaceSettingsPanel({ settings = fallbackSettings, canManage }: { settings?: ProductAgentModelSettings; canManage: boolean }) {
  return <div className="flex flex-col gap-4"><div><div className="flex flex-wrap gap-2"><Badge variant="secondary">工作区设置</Badge><Badge variant="outline">全局配置</Badge></div><p className="mt-2 text-sm text-muted-foreground">账号、Agent 和渠道属于工作区，不应成为项目流程节点。</p></div><Alert><ShieldCheckIcon /><AlertTitle>视频生成仍未启用</AlertTitle><AlertDescription>这里没有视频供应商、生成任务、预算或重试配置。</AlertDescription></Alert><Tabs defaultValue="security"><TabsList className={canManage ? "grid w-full grid-cols-4" : "grid w-full grid-cols-1"}>{canManage ? <><TabsTrigger value="agent"><Settings2Icon />Agent</TabsTrigger><TabsTrigger value="team"><MailPlusIcon />团队</TabsTrigger></> : null}<TabsTrigger value="security"><KeyRoundIcon />安全</TabsTrigger>{canManage ? <TabsTrigger value="channel"><ShieldAlertIcon />渠道</TabsTrigger> : null}</TabsList>{canManage ? <><TabsContent value="agent"><AgentSettings settings={settings} /></TabsContent><TabsContent value="team"><TeamSettings /></TabsContent></> : null}<TabsContent value="security"><SecuritySettings /></TabsContent>{canManage ? <TabsContent value="channel"><ChannelSettings /></TabsContent> : null}</Tabs></div>;
}
