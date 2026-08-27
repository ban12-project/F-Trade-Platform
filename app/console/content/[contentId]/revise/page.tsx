import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth-guard";
import { getContentCatalogDetail, listReadyProductContentSources } from "@/lib/content/store";
import { ConsoleLoading } from "@/components/console-loading";

import { ContentRevisionPanel } from "./content-revision-panel";

async function AuthorizedContentRevision({ contentId }: { contentId: string }) {
  await requireRole("admin");
  const [content, products] = await Promise.all([getContentCatalogDetail(contentId), listReadyProductContentSources()]);
  if (!content) notFound();
  return <ContentRevisionPanel content={content} product={products.find((product) => product.id === content.productId)} />;
}

function RevisionShell() {
  return <ConsoleLoading />;
}

export default function ContentRevisionPage({ params }: { params: Promise<{ contentId: string }> }) {
  return <Suspense fallback={<RevisionShell />}>{params.then(({ contentId }) => <AuthorizedContentRevision contentId={contentId} />)}</Suspense>;
}
