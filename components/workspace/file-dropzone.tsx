"use client";

import {
  FileInput,
  FileInputDropzone,
  FileInputItem,
  FileInputItemRemove,
  FileInputList,
  FileInputTrigger,
  formatFileSize,
} from "@ui-sdk/react/file-input";
import { FileIcon, UploadCloudIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function syncNativeFileInput(input: HTMLInputElement | null, files: File[]) {
  if (!input) return;
  if (!files.length) {
    if (input.value) input.value = "";
    return;
  }
  if (typeof DataTransfer === "undefined") return;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
}

export function FileDropzone({
  id,
  name,
  accept,
  multiple = false,
  maxFiles,
  maxSize,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  files,
  onFilesChange,
  onBlur,
  inputRef,
  emptyTitle = "拖拽文件到这里，或点击选择文件",
  emptyDescription = "也支持粘贴文件",
  buttonLabel,
  className,
}: {
  id: string;
  name?: string;
  accept?: string | readonly string[];
  multiple?: boolean;
  maxFiles?: number;
  maxSize?: number;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  emptyTitle?: string;
  emptyDescription?: string;
  buttonLabel?: string;
  className?: string;
}) {
  const nativeRef = useRef<HTMLInputElement | null>(null);
  const [rejectNotice, setRejectNotice] = useState("");
  const acceptString = typeof accept === "string" ? accept : accept?.join(",");

  const setMergedInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      nativeRef.current = element;
      if (!inputRef) return;
      if (typeof inputRef === "function") inputRef(element);
      else (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = element;
    },
    [inputRef],
  );

  useEffect(() => {
    syncNativeFileInput(nativeRef.current, files);
  }, [files]);

  function handleWidgetChange(nextFiles: File[], details?: { reason?: string }) {
    if (details?.reason === "reset") return;
    setRejectNotice("");
    const capped =
      maxFiles && nextFiles.length > maxFiles ? nextFiles.slice(0, maxFiles) : nextFiles;
    syncNativeFileInput(nativeRef.current, capped);
    onFilesChange(capped);
  }

  function handleNativeChange(event: React.ChangeEvent<HTMLInputElement>) {
    setRejectNotice("");
    const nextFiles = Array.from(event.target.files ?? []);
    onFilesChange(nextFiles);
  }

  function removeFile(index: number) {
    const nextFiles = files.filter((_, itemIndex) => itemIndex !== index);
    syncNativeFileInput(nativeRef.current, nextFiles);
    onFilesChange(nextFiles);
  }

  const triggerText =
    buttonLabel ?? (files.length ? (multiple ? "继续添加文件" : "更换文件") : "选择文件");

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <input
        ref={setMergedInputRef}
        id={id}
        name={name}
        type="file"
        accept={acceptString}
        multiple={multiple}
        disabled={disabled}
        required={required}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={handleNativeChange}
        className="sr-only"
      />
      <FileInput
        accept={accept}
        multiple={multiple}
        maxFiles={maxFiles}
        maxSize={maxSize}
        disabled={disabled}
        value={files}
        onValueChange={handleWidgetChange}
        onReject={(rejected) => {
          const reason = rejected[0]?.reasons[0];
          if (reason === "too-many-files") {
            setRejectNotice(`最多只能选择 ${maxFiles ?? 1} 个文件。`);
          } else if (reason === "file-too-large") {
            setRejectNotice("文件大小超出限制，请更换较小的文件。");
          } else if (reason === "file-type") {
            setRejectNotice("文件格式不支持，请检查允许的文件类型。");
          } else if (reason) {
            setRejectNotice("部分文件未通过格式或大小检查。");
          }
        }}
        className="flex flex-col gap-2"
      >
        <FileInputDropzone
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-muted/20 px-4 py-5 text-center transition-colors",
            "data-[dragging]:border-primary data-[dragging]:bg-primary/5",
            "data-[drag-reject]:border-destructive data-[drag-reject]:bg-destructive/5",
            invalid && "border-destructive",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          {(state) => (
            <>
              <UploadCloudIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {state.dragReject
                    ? "文件格式或数量不支持"
                    : state.dragAccept
                      ? "松开鼠标即可加入"
                      : emptyTitle}
                </p>
                <p className="text-xs text-muted-foreground">{emptyDescription}</p>
              </div>
              <FileInputTrigger
                type="button"
                disabled={disabled}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {triggerText}
              </FileInputTrigger>
            </>
          )}
        </FileInputDropzone>
        {rejectNotice ? (
          <p role="alert" className="text-xs text-destructive">
            {rejectNotice}
          </p>
        ) : null}
        {files.length ? (
          <FileInputList aria-label="已选择文件" className="flex flex-col gap-1.5">
            {files.map((file) => (
              <FileInputItem
                key={`${file.name}-${file.size}-${file.lastModified}`}
                file={file}
                className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate font-medium">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                </div>
                <FileInputItemRemove
                  type="button"
                  disabled={disabled}
                  aria-label={`移除 ${file.name}`}
                  onClick={() => removeFile(files.indexOf(file))}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </FileInputItemRemove>
              </FileInputItem>
            ))}
          </FileInputList>
        ) : null}
      </FileInput>
    </div>
  );
}
