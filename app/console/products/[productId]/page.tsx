import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getProductCatalogDetail } from "@/lib/products";

import { ProductReviewPanel } from "./product-review-panel";

async function AuthorizedProductReview({ productId }: { productId: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  const product = await getProductCatalogDetail(productId);
  if (!product) notFound();
  return <ProductReviewPanel product={product} />;
}

function ReviewShell() {
  return <main className="mx-auto min-h-svh w-full max-w-4xl p-6" aria-busy="true" />;
}

export default function ProductReviewPage({ params }: { params: Promise<{ productId: string }> }) {
  return (
    <Suspense fallback={<ReviewShell />}>
      {params.then(({ productId }) => <AuthorizedProductReview productId={productId} />)}
    </Suspense>
  );
}
