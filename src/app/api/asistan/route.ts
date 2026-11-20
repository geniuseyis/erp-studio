import { createLimiter, DEFAULT_MODEL, handleAsistan, HOURLY_IP_LIMIT, HOURLY_LIMIT } from "@/assistant/server";

// ANTHROPIC_API_KEY'i okuyan tek yer burasıdır; anahtar tarayıcıya hiç gitmez.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
// Sayaçlar sunucu örneğinin belleğindedir (kalıcı depo yok): en iyi çaba, asıl sınır Anthropic hesabındaki harcama sınırıdır.
const limiter = createLimiter(HOURLY_LIMIT, HOUR_MS);
const ipLimiter = createLimiter(HOURLY_IP_LIMIT, HOUR_MS);

export function POST(request: Request): Promise<Response> {
  return handleAsistan(request, {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
    limiter,
    ipLimiter,
  });
}
