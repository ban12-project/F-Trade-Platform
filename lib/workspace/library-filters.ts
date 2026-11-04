import type { WorkspaceLibraryRecord } from "./library-model";
import type { WorkspaceCollection } from "./navigation";

export type LibraryFilterKey = "project" | "type" | "state" | "q";

export function workspaceLibraryFilterOptions(
  records: WorkspaceLibraryRecord[],
  collection: WorkspaceCollection,
  query: URLSearchParams,
) {
  const project = query.get("project");
  const type = query.get("type");
  const scoped = records.filter(
    (record) => record.collection === collection && (!project || record.projectId === project),
  );
  return {
    types: [...new Set(scoped.map((record) => record.kind))],
    states: [
      ...new Set(
        scoped.filter((record) => !type || record.kind === type).map((record) => record.state),
      ),
    ],
  };
}

export function updateWorkspaceLibraryFilter(
  records: WorkspaceLibraryRecord[],
  collection: WorkspaceCollection,
  current: URLSearchParams,
  key: LibraryFilterKey,
  value: string,
) {
  const next = new URLSearchParams(current);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key === "project") {
    const { types } = workspaceLibraryFilterOptions(records, collection, next);
    if (next.has("type") && !types.some((type) => type === next.get("type"))) next.delete("type");
  }
  if (key === "project" || key === "type") {
    const { states } = workspaceLibraryFilterOptions(records, collection, next);
    if (next.has("state") && !states.includes(next.get("state") ?? "")) next.delete("state");
  }
  return next;
}

export function workspaceLibraryEmptyState(unavailable: boolean, query: URLSearchParams) {
  if (unavailable) return "unavailable";
  return query.size ? "no_matches" : "empty";
}
