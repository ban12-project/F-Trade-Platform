export type PublicationPayload = {
  accountRef: string;
  channelRef: string;
  format: "text" | "image" | "video";
  text: string;
  media?: { sha256: string };
};
export type PublicationRun = {
  id?: string;
  accountId?: string;
  kind: string;
  accountRef: string;
  channelRef: string;
  publication: PublicationPayload;
};
export type PreparedUpload = { path: string; media: { sha256: string } };
export type PublicationReceipt = {
  authorizationId: string;
  outcome: "published" | "unknown";
  externalPublicationRef?: string;
  failureCode?: string;
};
export type PublicationDriver<Session> = {
  open(run: PublicationRun, signal: AbortSignal): Promise<Session>;
  identity(session: Session): Promise<{ accountRef: string; channelRef: string }>;
  existingPublicationRefs(session: Session): Promise<string[]>;
  prepare(
    session: Session,
    payload: PublicationPayload,
    upload: PreparedUpload | null,
  ): Promise<void>;
  inspect(session: Session): Promise<{
    accountRef: string;
    channelRef: string;
    text: string;
    readyToPublish: boolean;
    attachmentCount: number;
    attachmentName?: string;
  }>;
  publish(
    session: Session,
    authorization: { authorizationId: string; localExpiresAt: number },
  ): Promise<void>;
  observe(
    session: Session,
    payload: PublicationPayload,
    signal: AbortSignal,
  ): Promise<{
    accountRef: string;
    channelRef: string;
    text: string;
    externalPublicationRef: unknown;
  }>;
  close(session: Session): Promise<void>;
};
export function createPublicationExecutor<Session>(
  driver: PublicationDriver<Session>,
): (context: {
  run: PublicationRun;
  signal: AbortSignal;
  preparePublicationMedia(): Promise<PreparedUpload>;
  authorizePublication(): Promise<{ authorizationId: string; localExpiresAt: number }>;
  reportPublication(receipt: PublicationReceipt): Promise<unknown>;
}) => Promise<"completed" | "failed" | "unknown">;
