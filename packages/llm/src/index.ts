export interface GenerateRequest {
  /** Stable instructions (site profile, rules). Providers cache this part. */
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

export interface LlmProvider {
  readonly id: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
