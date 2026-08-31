import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { getContentCatalogDetail } from "@/lib/content/store";
import { ConsoleLoading } from "@/components/console-loading";

import { ContentReviewPanel } from "./content-review-panel";

async function AuthorizedContentReview({ contentId }: { contentId: string }) {
  const session = await requirePermission("workspace:view");
  const content = await getContentCatalogDetail(contentId);
  if (!content) notFound();
  return <ContentReviewPanel content={content} canReview={hasPermission(session.user.role, "content:review")} />;
}

function ReviewShell() {
  return <ConsoleLoading />;
}

export default function ContentReviewPage({ params }: { params: Promise<{ contentId: string }> }) {
  return <Suspense fallback={<ReviewShell />}>{params.then(({ contentId }) => <AuthorizedContentReview contentId={contentId} />)}</Suspense>;
}
