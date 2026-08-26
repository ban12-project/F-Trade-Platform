import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getContentCatalogDetail } from "@/lib/content/store";
import { ConsoleLoading } from "@/components/console-loading";

import { ContentReviewPanel } from "./content-review-panel";

async function AuthorizedContentReview({ contentId }: { contentId: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
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
