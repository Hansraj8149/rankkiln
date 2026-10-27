import type { GenerateRequest, GenerateResult, LlmProvider } from "./index";
import { emptyUsage } from "./index";

/** Returns queued answers in order, for tests and offline runs. Records every request it receives. */
export class FakeProvider implements LlmProvider {
  readonly id = "fake";
  readonly requests: GenerateRequest<unknown>[] = [];

  constructor(private answers: unknown[]) {}

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    this.requests.push(req as GenerateRequest<unknown>);
    if (this.answers.length === 0) throw new Error("FakeProvider has no answers left.");
    return { data: req.schema.parse(this.answers.shift()), usage: emptyUsage(), model: "fake" };
  }
}
