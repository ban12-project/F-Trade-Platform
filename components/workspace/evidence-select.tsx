"use client";

import { createContext, useContext, useId, useState, useTransition } from "react";
import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldDescription } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listEvidenceOptionsAction } from "@/lib/actions/evidence-options";
import { useWorkspaceDirtyState } from "./dirty-state";
import { EvidenceLibrary } from "./product-evidence-library";

export type EvidenceChoice = { id: string; label: string; detail?: string };

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
  const labels = options.map((option, index) =>
    options.some((other) => other.id !== option.id && other.label === option.label)
      ? `${option.label} · ${option.detail ?? "资料"} · ${index + 1}`
      : option.label,
  );
  const selectedLabel = labels[options.findIndex((option) => option.id === value)];
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
        onValueChange={(next, details) => {
          // A failed refresh is not evidence that the user's selected ID was removed.
          // Base UI reconciles missing options by clearing the value; keep the draft on errors.
          if (next === null && value && result?.error && details.reason === "none") {
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
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={[descriptionId, describedBy].filter(Boolean).join(" ")}
          className="w-full"
        >
          <SelectValue placeholder="请选择已保存的资料">
            {selectedLabel ??
              (selectionUnverified
                ? "已保留选择，暂时无法核对"
                : value
                  ? "请重新选择资料"
                  : undefined)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option, index) => (
              <SelectItem key={option.id} value={option.id} data-evidence-id={option.id}>
                <span className="min-w-0 whitespace-normal break-all">{labels[index]}</span>
              </SelectItem>
            ))}
            {!options.length ? (
              <SelectItem value="__empty" disabled>
                {pending ? "正在加载资料…" : result?.error ? "暂时无法加载资料" : "暂无可选资料"}
              </SelectItem>
            ) : null}
          </SelectGroup>
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
