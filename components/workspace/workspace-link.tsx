"use client";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceDirtyState } from "./dirty-state";

type Props = Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & {
  href: string;
  onFollow?: () => void;
};
function NavigationProgress() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className="workspace-link-progress"
      data-pending={pending || undefined}
    />
  );
}

export function WorkspaceLink({ href, onFollow, children, className, ...props }: Props) {
  const router = useRouter();
  const { dirty, requestNavigation } = useWorkspaceDirtyState();
  return (
    <Link
      {...props}
      className={cn("workspace-link", className)}
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
    >
      {children}
      <NavigationProgress />
    </Link>
  );
}
