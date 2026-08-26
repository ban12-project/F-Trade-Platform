import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getProductCatalogDetail } from "@/lib/products";
import { ConsoleLoading } from "@/components/console-loading";

import { ProductRevisionPanel } from "./product-revision-panel";

async function AuthorizedProductRevision({ productId }: { productId: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
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
