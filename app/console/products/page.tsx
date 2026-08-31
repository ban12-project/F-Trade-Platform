import { Suspense } from "react";

import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listProductCatalogEntries } from "@/lib/products";
import { ConsoleLoading } from "@/components/console-loading";

import { ProductCatalogPanel } from "./product-catalog-panel";

async function AuthorizedCatalog() {
  const session = await requirePermission("workspace:view");
  const entries = await listProductCatalogEntries();
  return <ProductCatalogPanel entries={entries} canReview={hasPermission(session.user.role, "product:review")} />;
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
