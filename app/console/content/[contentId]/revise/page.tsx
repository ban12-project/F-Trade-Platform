import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getContentCatalogDetail, listReadyProductContentSources } from "@/lib/content/store";

import { ContentRevisionPanel } from "./content-revision-panel";

async function AuthorizedContentRevision({ contentId }: { contentId: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  const [content, products] = await Promise.all([getContentCatalogDetail(contentId), listReadyProductContentSources()]);
  if (!content) notFound();
  return <ContentRevisionPanel content={content} product={products.find((product) => product.id === content.productId)} />;
}

function RevisionShell() {
  return <main className="mx-auto min-h-svh w-full max-w-4xl p-6" aria-busy="true" />;
}

export default function ContentRevisionPage({ params }: { params: Promise<{ contentId: string }> }) {
  return <Suspense fallback={<RevisionShell />}>{params.then(({ contentId }) => <AuthorizedContentRevision contentId={contentId} />)}</Suspense>;
}
