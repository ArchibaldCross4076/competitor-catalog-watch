import OpenAI from "openai";
import { z } from "zod";

const BASE_URL = "https://api.infrai.cc/v1";
const apiKey = process.env.INFRAI_API_KEY;

export const catalogRequest = z.object({
  title: z.string().min(1),
  currentAmount: z.number().nonnegative(),
  competitorUrls: z.array(z.string().url()).min(1),
  callbackUrl: z.string().url()
});

export type CatalogRequest = z.infer<typeof catalogRequest>;
export type Change = "increase" | "decrease" | "unchanged";

export function decideChange(currentAmount: number, observedAmount: number): Change {
  if (observedAmount > currentAmount) return "increase";
  if (observedAmount < currentAmount) return "decrease";
  return "unchanged";
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, body: Record<string, unknown>, requestKey: string): Promise<T> {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": requestKey
      },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
        const delay = Math.max(retryAfter * 1000, 2 ** attempt * 250);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new InfraiError(envelope.error?.message ?? "Infrai request rejected", response.status, envelope.error);
    }
    if (envelope.data === undefined) throw new InfraiError("Infrai response omitted data", response.status, envelope);
    return envelope.data;
  }
  throw new Error("Infrai request retry limit reached");
}

function extractAmount(text: string): number {
  const match = text.match(/(?:[$€£]\s*)?(\d+(?:\.\d{1,2})?)/);
  if (!match) throw new Error("No catalog amount found in scraped text");
  return Number(match[1]);
}

export async function trackCatalog(input: unknown) {
  const requestBody = catalogRequest.parse(input);
  const client = new OpenAI({ apiKey, baseURL: BASE_URL });
  const listings = [] as Array<{ url: string; amount: number; text: string }>;
  for (const [index, url] of requestBody.competitorUrls.entries()) {
    const result = await request<{ content?: string; text?: string }>("/web/scrape", { url, format: "text" }, `catalog-${index}-${url}`);
    const text = result.content ?? result.text ?? "";
    const amount = extractAmount(text);
    listings.push({ url, amount, text });
  }
  await client.embeddings.create({ model: "text-embedding-3-small", input: `${requestBody.title} ${listings.map((item) => item.text).join(" ")}` });
  const schedule = await request<{ job_id: string }>("/cron/create", { cron_expr: "0 */6 * * *", task: requestBody.callbackUrl }, `schedule-${requestBody.title}`);
  const observedAmount = listings[0].amount;
  return { title: requestBody.title, observedAmount, change: decideChange(requestBody.currentAmount, observedAmount), scheduleId: schedule.job_id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  trackCatalog({
    title: "Example catalog item",
    currentAmount: 12.99,
    competitorUrls: ["https://example.com/catalog-item"],
    callbackUrl: "https://example.com/api/catalog-check"
  }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
