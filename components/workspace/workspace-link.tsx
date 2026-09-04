"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useWorkspaceDirtyState } from "./dirty-state";

type Props = Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & {
  href: string;
  onFollow?: () => void;
};
export function WorkspaceLink({ href, onFollow, ...props }: Props) {
  const router = useRouter();
  const { dirty, requestNavigation } = useWorkspaceDirtyState();
  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        if (!dirty) {
          onFollow?.();
          return;
        }
        event.preventDefault();
        requestNavigation(() => {
          onFollow?.();
          if (props.replace) router.replace(href, { scroll: props.scroll });
          else router.push(href, { scroll: props.scroll });
        });
      }}
    />
  );
}
