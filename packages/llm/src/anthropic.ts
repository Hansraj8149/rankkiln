import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Effort, GenerateRequest, GenerateResult, LlmProvider, Usage } from "./index";

export const DEFAULT_MODEL = "claude-opus-5-5";

// US dollars per million tokens: input, output, cache read, cache write (5-minute). Update when prices change.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

/** Approximate cost in US dollars, or null for a model without a known price. */
export function estimateCost(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (u.inputTokens * p[0] + u.outputTokens * p[1] + u.cacheReadTokens * p[2] + u.cacheWriteTokens * p[3]) / 1e6;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  private client: Anthropic;
  private model: string;
  private effort: Effort;

  constructor(opts: { apiKey?: string; model?: string; effort?: Effort } = {}) {
    this.model = opts.model || DEFAULT_MODEL;
    this.effort = opts.effort ?? "medium";
    // With no key given, the SDK reads ANTHROPIC_API_KEY (or a logged-in profile) itself.
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      // On a policy decline the API retries on a suitable fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: req.effort ?? this.effort, format: betaZodOutputFormat(req.schema) },
    });

    if (res.stop_reason === "refusal")
      throw new Error(`The model declined this request (${res.stop_details?.category ?? "no category"}).`);
    if (res.stop_reason === "max_tokens")
      throw new Error("The answer was cut off at the token limit. Try a narrower topic.");
    if (res.parsed_output == null) throw new Error("The model's answer didn't match the expected format.");

    return {
      data: res.parsed_output as T,
      model: res.model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
