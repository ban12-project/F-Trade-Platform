import { Suspense } from "react";

import { requireRole } from "@/lib/auth-guard";
import { listProductCatalogEntries } from "@/lib/products";
import { ConsoleLoading } from "@/components/console-loading";

import { ProductCatalogPanel } from "./product-catalog-panel";

async function AuthorizedCatalog() {
  await requireRole("admin");
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
