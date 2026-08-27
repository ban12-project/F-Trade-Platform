import { Suspense } from "react";

import { requireAdmin } from "@/lib/auth-guard";
import { listContentCatalogEntries, listReadyProductContentSources } from "@/lib/content/store";
import { ConsoleLoading } from "@/components/console-loading";

import { ContentCatalogPanel } from "./content-catalog-panel";

async function AuthorizedContentCatalog() {
  await requireAdmin();
  const [entries, products] = await Promise.all([listContentCatalogEntries(), listReadyProductContentSources()]);
  return <ContentCatalogPanel entries={entries} products={products} />;
}

function ContentShell() {
  return <ConsoleLoading />;
}

export default function ContentPage() {
  return <Suspense fallback={<ContentShell />}><AuthorizedContentCatalog /></Suspense>;
}
