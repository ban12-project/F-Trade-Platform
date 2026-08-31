import { Suspense } from "react";

import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listContentCatalogEntries, listReadyProductContentSources } from "@/lib/content/store";
import { ConsoleLoading } from "@/components/console-loading";

import { ContentCatalogPanel } from "./content-catalog-panel";

async function AuthorizedContentCatalog() {
  const session = await requirePermission("workspace:view");
  const [entries, products] = await Promise.all([listContentCatalogEntries(), listReadyProductContentSources()]);
  return <ContentCatalogPanel entries={entries} products={products} canReview={hasPermission(session.user.role, "content:review")} />;
}

function ContentShell() {
  return <ConsoleLoading />;
}

export default function ContentPage() {
  return <Suspense fallback={<ContentShell />}><AuthorizedContentCatalog /></Suspense>;
}
