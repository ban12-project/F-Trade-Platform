"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { PublicationChannel } from "@/lib/social/publication-store";
import { publishingBlockers } from "@/lib/social/publishing-account-policy";
import { WorkspaceLink } from "./workspace-link";
export const publishingAccountKey = (account: PublicationChannel) =>
  JSON.stringify([account.channelRef, account.accountRef]);
export function PublishingAccountSelect({
  accounts,
  value,
  onChange,
  disabled = false,
  id,
}: {
  accounts: PublicationChannel[];
  value: string;
  onChange: (account: PublicationChannel) => void;
  disabled?: boolean;
  id: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = accounts.find((a) => publishingAccountKey(a) === value);
  const returnTo = `${pathname}${params.size ? `?${params}` : ""}`;
  return (
    <div className="space-y-2">
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const account = accounts.find((a) => publishingAccountKey(a) === event.target.value);
          if (account) onChange(account);
        }}
      >
        <NativeSelectOption value="">
          {accounts.length ? "请选择发布账号" : "尚未添加发布账号"}
        </NativeSelectOption>
        {accounts.map((account) => (
          <NativeSelectOption
            key={publishingAccountKey(account)}
            value={publishingAccountKey(account)}
          >
            {account.platform ?? "Facebook"} · {account.name ?? account.accountRef} ·{" "}
            {account.ready
              ? "可以提交发布"
              : account.blockers?.length
                ? publishingBlockers[account.blockers[0]]
                : "需要核对发布条件"}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {selected?.blockers?.length ? (
        <ol className="list-decimal pl-5 text-sm text-muted-foreground">
          {selected.blockers.map((blocker) => (
            <li key={blocker}>{publishingBlockers[blocker]}</li>
          ))}
        </ol>
      ) : null}
      <WorkspaceLink
        className="text-sm underline"
        href={`/workspace/settings?section=channels&returnTo=${encodeURIComponent(returnTo)}`}
      >
        去配置渠道（发布账号）
      </WorkspaceLink>
    </div>
  );
}
