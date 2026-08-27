import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth-guard";
import { getProductCatalogDetail } from "@/lib/products";
import { ConsoleLoading } from "@/components/console-loading";

import { ProductReviewPanel } from "./product-review-panel";

async function AuthorizedProductReview({ productId }: { productId: string }) {
  await requireAdmin();
  const product = await getProductCatalogDetail(productId);
  if (!product) notFound();
  return <ProductReviewPanel product={product} />;
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
