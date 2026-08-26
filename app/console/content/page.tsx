import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { listContentCatalogEntries, listReadyProductContentSources } from "@/lib/content/store";
import { ConsoleLoading } from "@/components/console-loading";

import { ContentCatalogPanel } from "./content-catalog-panel";

async function AuthorizedContentCatalog() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  const [entries, products] = await Promise.all([listContentCatalogEntries(), listReadyProductContentSources()]);
  return <ContentCatalogPanel entries={entries} products={products} />;
}

function ContentShell() {
  return <ConsoleLoading />;
}

export default function ContentPage() {
  return <Suspense fallback={<ContentShell />}><AuthorizedContentCatalog /></Suspense>;
}
