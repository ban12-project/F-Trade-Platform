"use client";

import {
  Select,
  SelectContent,
  SelectEmpty,
  SelectGroup,
  SelectGroupLabel,
  SelectInput,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { createContext, useContext, useId, useMemo, useRef, useState, useTransition } from "react";
import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldDescription } from "@/components/ui/field";
import { listEvidenceOptionsAction } from "@/lib/actions/evidence-options";
import { cn } from "@/lib/utils";
import type { EvidenceOption } from "@/lib/workspace/access";
import {
  buildEvidenceDisplayItems,
  type EvidenceChoice,
  evidenceChoiceFromOption,
} from "@/lib/workspace/evidence-display";
import { useWorkspaceDirtyState } from "./dirty-state";
import { EvidenceLibrary } from "./product-evidence-library";

export type { EvidenceChoice };

const EvidenceChoicesContext = createContext<EvidenceChoice[] | undefined>(undefined);
export function EvidenceChoicesProvider({
  options,
  children,
}: {
  options: EvidenceChoice[];
  children: React.ReactNode;
}) {
  return <EvidenceChoicesContext value={options}>{children}</EvidenceChoicesContext>;
}

const triggerClassName = cn(
  "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm transition-colors outline-none",
  "hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-destructive/20",
);

const contentClassName = cn(
  "z-50 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg",
);

const inputWrapperClassName = "flex items-center gap-2 border-b border-border px-3 py-2";
const searchInputClassName =
  "w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none";
const listClassName = "max-h-72 overflow-y-auto p-1";
const groupLabelClassName = "px-2 py-1.5 text-xs font-medium text-muted-foreground";
const itemClassName = cn(
  "relative flex w-full cursor-default items-center justify-between gap-2 rounded-md px-2 py-2 text-sm outline-none select-none",
  "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
  "data-[selected]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
);

function filterEvidenceItem(
  item: { value?: unknown; label?: string },
  query: string,
  displayItems: ReturnType<typeof buildEvidenceDisplayItems>,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/);
  const entry = displayItems.find((candidate) => candidate.id === item.value);
  const haystack = [item.label ?? "", ...(entry?.keywords ?? [])].join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function EvidenceDropdownBody({
  options,
  retainedRef,
  emptyMessage,
  emptyDisabled = false,
}: {
  options: EvidenceChoice[];
  retainedRef?: string;
  emptyMessage?: string;
  emptyDisabled?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const displayItems = useMemo(() => buildEvidenceDisplayItems(options), [options]);
  const currentItems = displayItems.filter((item) => item.group === "current");
  const otherItems = displayItems.filter((item) => item.group === "other");

  function renderGroup(label: string, items: typeof displayItems) {
    if (!items.length) return null;
    return (
      <SelectGroup>
        <SelectGroupLabel className={groupLabelClassName}>{label}</SelectGroupLabel>
        {items.map((item) => (
          <SelectItem
            key={item.id}
            value={item.id}
            label={item.displayText}
            data-evidence-id={item.id}
            className={itemClassName}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <SelectItemText className="min-w-0 whitespace-normal break-all font-medium [&_mark]:rounded-xs [&_mark]:bg-primary/15 [&_mark]:text-foreground">
                  {item.displayText}
                </SelectItemText>
                {item.typeBadge ? (
                  <Badge variant="outline" aria-hidden="true" className="shrink-0 text-[10px]">
                    {item.typeBadge}
                  </Badge>
                ) : null}
              </span>
              {item.rawLabel !== item.primaryLabel ? (
                <span aria-hidden="true" className="truncate text-xs text-muted-foreground">
                  {item.rawLabel}
                </span>
              ) : null}
            </div>
            <SelectItemIndicator className="shrink-0">
              <CheckIcon className="size-4" aria-hidden="true" />
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectGroup>
    );
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.currentTarget.value || (event.key !== "Home" && event.key !== "End")) return;
    const enabledOptions = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-disabled="true"])',
      ) ?? [],
    );
    const target = event.key === "Home" ? enabledOptions[0] : enabledOptions.at(-1);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: "nearest" });
    target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    target.focus();
  }

  return (
    <>
      <div className={inputWrapperClassName}>
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectInput
          aria-label="搜索资料"
          placeholder="搜索文件名、类型或日期…"
          onKeyDown={handleSearchKeyDown}
          className={searchInputClassName}
        />
      </div>
      <SelectEmpty className="px-3 py-6 text-center text-sm text-muted-foreground">
        没有匹配的资料，请尝试其他关键词或上传新文件。
      </SelectEmpty>
      <SelectList ref={listRef} className={listClassName}>
        {retainedRef && !options.some((item) => item.id === retainedRef) ? (
          <SelectGroup>
            <SelectGroupLabel className={groupLabelClassName}>原有引用</SelectGroupLabel>
            <SelectItem value={retainedRef} label="保留原来源资料" className={itemClassName}>
              <SelectItemText>保留原来源资料</SelectItemText>
              <SelectItemIndicator>
                <CheckIcon className="size-4" aria-hidden="true" />
              </SelectItemIndicator>
            </SelectItem>
          </SelectGroup>
        ) : null}
        {currentItems.length ? renderGroup("当前项目资料", currentItems) : null}
        {currentItems.length && otherItems.length ? (
          <SelectSeparator className="my-1 h-px bg-border" />
        ) : null}
        {otherItems.length
          ? renderGroup(currentItems.length ? "其他历史资料" : "可选资料", otherItems)
          : null}
        {!displayItems.length && !retainedRef && emptyMessage ? (
          <SelectItem
            value="__empty"
            label={emptyMessage}
            disabled={emptyDisabled}
            className={itemClassName}
          >
            <SelectItemText>{emptyMessage}</SelectItemText>
          </SelectItem>
        ) : null}
      </SelectList>
    </>
  );
}

export function StaticEvidenceCombobox({
  options,
  retainedRef,
  value,
  onValueChange,
  onBlur,
  inputRef,
  id,
  "aria-describedby": describedBy,
  invalid,
  required,
  disabled,
  placeholder = "选择或搜索已上传资料",
}: {
  options: EvidenceOption[];
  retainedRef?: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLButtonElement>;
  id: string;
  "aria-describedby"?: string;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const choices = useMemo(() => options.map(evidenceChoiceFromOption), [options]);
  const displayItems = useMemo(() => buildEvidenceDisplayItems(choices), [choices]);
  const selectedItem = displayItems.find((item) => item.id === value);
  const selectedLabel = selectedItem
    ? selectedItem.hasDuplicate
      ? selectedItem.displayText
      : selectedItem.primaryLabel
    : value && value === retainedRef
      ? "保留原来源资料"
      : undefined;

  return (
    <Select
      value={value || null}
      disabled={disabled || (!choices.length && !retainedRef)}
      filter={(item, query) => filterEvidenceItem(item, query, displayItems)}
      itemToLabel={(val) =>
        displayItems.find((item) => item.id === val)?.displayText ??
        (val === retainedRef ? "保留原来源资料" : String(val))
      }
      onValueChange={(next) => {
        if (next === "__empty") return;
        onValueChange(next ?? "");
      }}
    >
      <SelectTrigger
        id={id}
        ref={inputRef}
        data-slot="select-trigger"
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        className={triggerClassName}
      >
        <SelectValue
          data-slot="select-value"
          placeholder={placeholder}
          className="min-w-0 flex-1 truncate"
        >
          {selectedLabel ?? placeholder}
        </SelectValue>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className={contentClassName}>
        <EvidenceDropdownBody
          options={choices}
          retainedRef={retainedRef}
          emptyMessage="暂无可选资料"
          emptyDisabled
        />
      </SelectContent>
    </Select>
  );
}

export function EvidenceSelect({
  projectId,
  id,
  value,
  onValueChange,
  onBlur,
  inputRef,
  "aria-describedby": describedBy,
  invalid,
  disabled,
  videoId,
  options: initialOptions,
}: {
  projectId: string;
  videoId?: string;
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLButtonElement>;
  "aria-describedby"?: string;
  invalid?: boolean;
  disabled?: boolean;
  options?: EvidenceChoice[];
}) {
  const { requestNavigation } = useWorkspaceDirtyState();
  const [uploadDirty, setUploadDirty] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const sharedOptions = useContext(EvidenceChoicesContext);
  const descriptionId = useId();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [result, setResult] = useState<{ options: EvidenceChoice[]; error: string } | null>(
    initialOptions || sharedOptions
      ? { options: initialOptions ?? sharedOptions ?? [], error: "" }
      : null,
  );
  const [pending, startTransition] = useTransition();
  const options = result?.options ?? [];
  const displayItems = useMemo(() => buildEvidenceDisplayItems(options), [options]);
  const selectedItem = displayItems.find((item) => item.id === value);
  const selectedLabel = selectedItem?.displayText;
  const selectionUnverified = Boolean(value && result?.error);

  function refresh(selectEvidenceId?: string) {
    startTransition(async () => {
      try {
        const next = await listEvidenceOptionsAction({
          projectId,
          ...(videoId ? { videoId } : {}),
        });
        setResult(next);
        if (selectEvidenceId && next.options.some((option) => option.id === selectEvidenceId)) {
          onValueChange(selectEvidenceId);
        } else if (!next.error && value && !next.options.some((option) => option.id === value)) {
          onValueChange("");
        }
      } catch {
        setResult({ options: [], error: "资料加载失败，请重试。" });
      }
    });
  }

  return (
    <>
      <Select
        value={value || null}
        disabled={disabled}
        filter={(item, query) => filterEvidenceItem(item, query, displayItems)}
        itemToLabel={(val) =>
          displayItems.find((item) => item.id === val)?.displayText ?? String(val)
        }
        onValueChange={(next, details) => {
          if (next === "__empty") {
            details.cancel();
            return;
          }
          if (next === null && value && result?.error && details.reason === "restore") {
            details.cancel();
            return;
          }
          onValueChange(next ?? "");
        }}
        onOpenChange={(open) => {
          if (open && !result && !pending) refresh();
        }}
      >
        <SelectTrigger
          id={id}
          ref={inputRef}
          data-slot="select-trigger"
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={[descriptionId, describedBy].filter(Boolean).join(" ")}
          className={triggerClassName}
        >
          <SelectValue
            data-slot="select-value"
            placeholder="请选择已保存的资料"
            className="min-w-0 flex-1 truncate"
          >
            {selectedLabel ??
              (selectionUnverified
                ? "已保留选择，暂时无法核对"
                : value
                  ? "请重新选择资料"
                  : "请选择已保存的资料")}
          </SelectValue>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className={contentClassName}>
          <EvidenceDropdownBody
            options={options}
            emptyMessage={
              pending ? "正在加载资料…" : result?.error ? "暂时无法加载资料" : "暂无可选资料"
            }
            emptyDisabled
          />
        </SelectContent>
      </Select>
      <FieldDescription id={descriptionId} aria-live="polite" className="break-all">
        {result?.error
          ? `${result.error}${selectionUnverified ? " 已保留原选择，请恢复资料列表后核对。" : ""}`
          : result && !options.length
            ? "暂无可用资料，请上传文件后选择。"
            : selectedLabel
              ? `已选择：${selectedLabel}。请核对是否与本次操作对应。`
              : "请选择与本次操作对应的文件。"}
      </FieldDescription>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || pending}
          onClick={() => refresh()}
        >
          {pending ? "正在加载…" : "刷新资料列表"}
        </Button>
        <Dialog
          open={uploadOpen}
          onOpenChange={(open) => {
            if (open) setUploadOpen(true);
            else if (!uploadBusy) {
              if (uploadDirty) requestNavigation(() => setUploadOpen(false));
              else setUploadOpen(false);
            }
          }}
        >
          <DialogTrigger
            render={<Button type="button" variant="outline" size="sm" disabled={disabled} />}
          >
            上传资料
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加来源资料</DialogTitle>
            </DialogHeader>
            {uploadOpen ? (
              <EvidenceLibrary
                projectId={projectId}
                evidenceOptions={[]}
                onDraftDirty={setUploadDirty}
                onBusyChange={setUploadBusy}
                onUploaded={(evidenceId) => {
                  setUploadOpen(false);
                  refresh(evidenceId);
                }}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

export function EvidenceSelectField<T extends FieldValues>({
  control,
  name,
  ...props
}: {
  control: Control<T>;
  name: FieldPath<T>;
} & Omit<
  React.ComponentProps<typeof EvidenceSelect>,
  "value" | "onValueChange" | "onBlur" | "inputRef"
>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <EvidenceSelect
          {...props}
          value={field.value ?? ""}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
          invalid={fieldState.invalid}
        />
      )}
    />
  );
}
