"use client";
import type { PublicationChannel } from "@/lib/social/publication-store";
import { PublicationComposer, type PublicationMediaOptions } from "./publication-composer";
export function FacebookMediaPanel({
  projectId,
  contentRef,
  options,
  accounts = [],
}: {
  projectId: string;
  contentRef: string;
  options: PublicationMediaOptions;
  channelRef: string;
  accountRef: string;
  accounts?: PublicationChannel[];
}) {
  return (
    <PublicationComposer
      projectId={projectId}
      contentRef={contentRef}
      media={options}
      accounts={accounts}
    />
  );
}
