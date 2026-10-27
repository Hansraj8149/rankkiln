import type { ZodType } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface GenerateRequest<T> {
  /** Stable instructions (site profile, rules). Kept identical across calls so providers can cache it. */
  system: string;
  prompt: string;
  /** The answer must match this schema. */
  schema: ZodType<T>;
  maxTokens?: number;
  effort?: Effort;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface GenerateResult<T> {
  data: T;
  usage: Usage;
  model: string;
}

export interface LlmProvider {
  readonly id: string;
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export { AnthropicProvider, estimateCost } from "./anthropic";
export { FakeProvider } from "./fake";
