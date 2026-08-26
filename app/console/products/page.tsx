import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { listProductCatalogEntries } from "@/lib/products";
import { ConsoleLoading } from "@/components/console-loading";

import { ProductCatalogPanel } from "./product-catalog-panel";

async function AuthorizedCatalog() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  const entries = await listProductCatalogEntries();
  return <ProductCatalogPanel entries={entries} />;
}

function CatalogShell() {
  return <ConsoleLoading />;
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<CatalogShell />}>
      <AuthorizedCatalog />
    </Suspense>
  );
}
