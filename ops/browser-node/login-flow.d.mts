export function runFacebookLoginFlow(input: {
  credentials?: {
    username?: string;
    password?: string;
    totpSecret?: string;
    messengerPin?: string;
  };
  acquireCredentials?(phase: string): Promise<Record<string, unknown> | null>;
  observeOnly?: boolean;
  observe(): Promise<Record<string, unknown>>;
  submit(phase: string, values: Record<string, unknown>): Promise<unknown>;
  assertActive(): void;
  onAttention?(reason: string): Promise<void>;
  deadline: number;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}): Promise<{
  outcome: string;
  reason?: string;
  factorPrompts: string[];
  historyEvidence?: string;
}>;
