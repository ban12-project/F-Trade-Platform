import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { listContentCatalogEntries, listReadyProductContentSources } from "@/lib/content/store";

import { ContentCatalogPanel } from "./content-catalog-panel";

async function AuthorizedContentCatalog() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") redirect("/auth");
  const [entries, products] = await Promise.all([listContentCatalogEntries(), listReadyProductContentSources()]);
  return <ContentCatalogPanel entries={entries} products={products} />;
}

function ContentShell() {
  return <main className="mx-auto min-h-svh w-full max-w-7xl p-6" aria-busy="true" />;
}

export default function ContentPage() {
  return <Suspense fallback={<ContentShell />}><AuthorizedContentCatalog /></Suspense>;
}
