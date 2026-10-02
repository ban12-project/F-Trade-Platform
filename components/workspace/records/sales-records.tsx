import "server-only";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { hasPermission } from "@/lib/authz";
import { listActorReadyProductContentSources } from "@/lib/content/store";
import type { SalesRelationRecord } from "@/lib/sales/journey";
import { readSalesJourney } from "@/lib/sales/journey-store";
import { listProjectRfqEntries } from "@/lib/sales/store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { listProjectReadyProductReferences } from "@/lib/workspace/store";
import { DeliveryPanel, LeadPanel, QuotationPanel } from "../closing-panels";
import { ProductReferencePanel } from "../product-reference-panel";
import type { RecordContext } from "../record-page";
import { RfqChooser } from "../rfq-chooser";
import { RfqDetail } from "../rfq-detail";
import { RfqForm } from "../rfq-form";
import { SalesContext } from "../sales-context";

async function ProductReferences({ context }: { context: RecordContext }) {
  const linked = await listProjectReadyProductReferences(context.projectId);
  if (linked.length || !context.canWrite) return null;
  const available = await listActorReadyProductContentSources(context.session.user.id);
  return (
    <ProductReferencePanel projectId={context.projectId} linked={linked} available={available} />
  );
}
export async function SalesRecord({ context }: { context: RecordContext }) {
  const { projectId, recordId, session, kind, canWrite } = context;
  const selected = { kind: kind as SalesRelationRecord["kind"], id: recordId! };
  const data = await readSalesJourney(
    projectId,
    session.user.id,
    kind === "lead" ? recordId : undefined,
    selected,
  );
  const related = (
    <SalesContext
      projectId={projectId}
      records={data.records}
      kind={selected.kind}
      id={recordId!}
      canWrite={canWrite}
      returnTo={context.returnTo}
    />
  );
  if (kind === "rfq") {
    const entry = data.rfqs.find((item) => item.id === recordId);
    if (!entry) notFound();
    return (
      <RfqDetail projectId={projectId} entry={entry} leads={data.leads}>
        {related}
        {entry.state === "RFQ_READY" ? (
          <Suspense fallback={<p>正在加载可引用产品</p>}>
            <ProductReferences context={context} />
          </Suspense>
        ) : null}
      </RfqDetail>
    );
  }
  if (kind === "quotation") {
    const entry = data.quotations.find((item) => item.id === recordId);
    if (!entry) notFound();
    const products =
      entry.state === "QUOTE_REVISION_REQUIRED"
        ? await listProjectReadyProductReferences(projectId)
        : [];
    return (
      <div className="space-y-5">
        {related}
        <QuotationPanel
          projectId={projectId}
          entries={[entry]}
          showCreateForm={false}
          rfqs={data.rfqs}
          products={products}
          canReview={canWrite && hasPermission(session.user.role, "quotation:review")}
        />
      </div>
    );
  }
  if (kind === "delivery") {
    const entry = data.deliveries.find((item) => item.id === recordId);
    if (!entry) notFound();
    return (
      <div className="space-y-5">
        {related}
        <DeliveryPanel
          projectId={projectId}
          entries={[entry]}
          canReview={canWrite && hasPermission(session.user.role, "delivery:review")}
        />
      </div>
    );
  }
  const entry = data.leads.find((item) => item.id === recordId);
  if (!entry) notFound();
  return (
    <div className="space-y-5">
      {related}
      <LeadPanel
        projectId={projectId}
        entries={[entry]}
        deliveries={data.deliveries.filter(
          (item) => item.id === entry.lead.delivery_confirmation_ref,
        )}
      />
    </div>
  );
}
export async function SalesCreate({ context }: { context: RecordContext }) {
  const { projectId, kind, sourceId, sourceKind, session, returnTo } = context;
  if (kind === "rfq") {
    const data = sourceId
      ? await readSalesJourney(projectId, session.user.id, undefined, {
          kind: "lead",
          id: sourceId,
        })
      : { leads: [], rfqs: [], records: [] };
    const linked = data.rfqs.filter((item) => item.formValues.leadId === sourceId);
    if (linked.length === 1)
      redirect(workspaceRecordHref(projectId, "rfq", linked[0].id, returnTo));
    if (
      sourceId &&
      !data.leads.some((item) => item.id === sourceId && item.state === "LEAD_RECEIVED") &&
      !linked.length
    )
      notFound();
    return linked.length > 1 ? (
      <RfqChooser projectId={projectId} entries={linked} />
    ) : (
      <RfqForm projectId={projectId} leads={data.leads} selectedLeadId={sourceId} />
    );
  }
  if (kind !== "quotation") notFound();
  const data = sourceId
    ? await readSalesJourney(projectId, session.user.id, undefined, { kind: "rfq", id: sourceId })
    : null;
  const rfqs = sourceId
    ? (data?.rfqs.filter((item) => item.id === sourceId && item.state === "RFQ_READY") ?? [])
    : (await listProjectRfqEntries(projectId)).filter((item) => item.state === "RFQ_READY");
  if (sourceKind && !rfqs.length) notFound();
  const products = await listProjectReadyProductReferences(projectId);
  const available = await listActorReadyProductContentSources(session.user.id);
  return (
    <div className="space-y-5">
      {sourceId && data ? (
        <SalesContext
          projectId={projectId}
          records={data.records}
          kind="rfq"
          id={sourceId}
          canWrite
          hideContinuation
          returnTo={returnTo}
        />
      ) : null}
      <QuotationPanel
        projectId={projectId}
        entries={[]}
        showCreateForm
        rfqs={rfqs}
        products={products}
        canReview={false}
      />
      <ProductReferencePanel projectId={projectId} available={available} linked={products} />
    </div>
  );
}
