import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth-guard";
import { getContentCatalogDetail } from "@/lib/content/store";
import { ConsoleLoading } from "@/components/console-loading";

import { ContentReviewPanel } from "./content-review-panel";

async function AuthorizedContentReview({ contentId }: { contentId: string }) {
  await requireAdmin();
  const content = await getContentCatalogDetail(contentId);
  if (!content) notFound();
  return <ContentReviewPanel content={content} />;
}

function ReviewShell() {
  return <ConsoleLoading />;
}

export default function ContentReviewPage({ params }: { params: Promise<{ contentId: string }> }) {
  return <Suspense fallback={<ReviewShell />}>{params.then(({ contentId }) => <AuthorizedContentReview contentId={contentId} />)}</Suspense>;
}
