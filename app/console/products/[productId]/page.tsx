import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { getProductCatalogDetail } from "@/lib/products";
import { ConsoleLoading } from "@/components/console-loading";

import { ProductReviewPanel } from "./product-review-panel";

async function AuthorizedProductReview({ productId }: { productId: string }) {
  const session = await requirePermission("workspace:view");
  const product = await getProductCatalogDetail(productId);
  if (!product) notFound();
  return <ProductReviewPanel product={product} canReview={hasPermission(session.user.role, "product:review")} />;
}

function ReviewShell() {
  return <ConsoleLoading />;
}

export default function ProductReviewPage({ params }: { params: Promise<{ productId: string }> }) {
  return (
    <Suspense fallback={<ReviewShell />}>
      {params.then(({ productId }) => <AuthorizedProductReview productId={productId} />)}
    </Suspense>
  );
}
