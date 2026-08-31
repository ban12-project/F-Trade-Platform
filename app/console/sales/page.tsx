import { Suspense } from "react";
import { ConsoleLoading } from "@/components/console-loading";
import { requirePermission } from "@/lib/auth-guard";
import { listRfqEntries } from "@/lib/sales/store";
import { SalesPanel } from "./sales-panel";

async function AuthorizedSales() { await requirePermission("sales:write"); return <SalesPanel entries={await listRfqEntries()} />; }
export default function SalesPage() { return <Suspense fallback={<ConsoleLoading />}><AuthorizedSales /></Suspense>; }
