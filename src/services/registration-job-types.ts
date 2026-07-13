export type RegistrationJobMode = "single" | "fill" | "create";
export type RegistrationJobState = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type RegistrationMailChannel = "yyds" | "tempmail_lol" | "gonebox";

export const DEFAULT_REGISTRATION_MAIL_CHANNEL: RegistrationMailChannel = "tempmail_lol";

/** Normalize a requested mail channel while keeping old queued jobs compatible. */
export function normalizeRegistrationMailChannel(value: unknown): RegistrationMailChannel {
  if (value === undefined) {
    return DEFAULT_REGISTRATION_MAIL_CHANNEL;
  }
  if (value === "yyds" || value === "tempmail_lol" || value === "gonebox") {
    return value;
  }
  throw new Error('mailboxChannel must be one of "yyds", "tempmail_lol", or "gonebox"');
}

export type RegistrationJobCreateInput =
  | { mode: "single"; mailboxChannel?: RegistrationMailChannel }
  | { mode: "fill"; target?: number; concurrency?: number; mailboxChannel?: RegistrationMailChannel }
  | { mode: "create"; count: number; concurrency?: number; mailboxChannel?: RegistrationMailChannel };

export type RegistrationJobPayload =
  | { mode: "single"; mailboxChannel?: RegistrationMailChannel; cancelRequested?: boolean }
  | { mode: "fill"; target: number; concurrency: number; mailboxChannel?: RegistrationMailChannel; cancelRequested?: boolean }
  | { mode: "create"; count: number; concurrency: number; mailboxChannel?: RegistrationMailChannel; cancelRequested?: boolean };

export interface RegistrationJobProgress {
  started: number;
  completed: number;
  failed: number;
  total: number;
  skipped?: number;
}

export interface RegistrationJobLog {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RegistrationJobSnapshot {
  id: string;
  mode: RegistrationJobMode;
  state: RegistrationJobState;
  target?: number;
  count?: number;
  concurrency?: number;
  progress: RegistrationJobProgress;
  logs: RegistrationJobLog[];
  results?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface RegistrationJobCreateResponse {
  jobId: string;
}
