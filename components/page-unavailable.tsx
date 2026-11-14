import type { ReactNode } from "react";
import { RecoveryTitle } from "@/components/recovery-title";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";

export function PageUnavailable({
  title,
  description,
  returnLink,
}: {
  title: string;
  description: string;
  returnLink: ReactNode;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-64 items-center p-4">
      <RecoveryTitle title={`${title} · F-Trade`} />
      <Empty>
        <EmptyHeader>
          <h1 className="text-lg font-semibold">{title}</h1>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{returnLink}</EmptyContent>
      </Empty>
    </main>
  );
}
