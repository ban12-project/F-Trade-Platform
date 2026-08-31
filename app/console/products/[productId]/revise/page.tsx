import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requirePermission } from "@/lib/auth-guard";
import { getProductCatalogDetail } from "@/lib/products";
import { ConsoleLoading } from "@/components/console-loading";

import { ProductRevisionPanel } from "./product-revision-panel";

async function AuthorizedProductRevision({ productId }: { productId: string }) {
  await requirePermission("product:write");
  const product = await getProductCatalogDetail(productId);
  if (!product) notFound();
  return <ProductRevisionPanel product={product} />;
}

function RevisionShell() {
  return <ConsoleLoading />;
}

export default function ProductRevisionPage({ params }: { params: Promise<{ productId: string }> }) {
  return <Suspense fallback={<RevisionShell />}>{params.then(({ productId }) => <AuthorizedProductRevision productId={productId} />)}</Suspense>;
}
