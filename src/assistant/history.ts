/** Sunucuya gönderilen konuşmada tutulan son tam alışveriş sayısı (soru + araç turları + cevap). */
export const KEEP_EXCHANGES = 3;

type Turn = { role: "user" | "assistant"; content: string | unknown[] };

/**
 * Konuşmayı son `keep` alışverişe kısaltır. Kesim her zaman düz bir kullanıcı mesajının (string içerik) başındadır;
 * böylece bir araç çağrısı ile sonucu birbirinden ayrılmaz. Son mesaj (şimdiki soru) her zaman kalır.
 */
export function trimHistory<T extends Turn>(messages: T[], keep: number = KEEP_EXCHANGES): T[] {
  const starts: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === "user" && typeof m.content === "string") starts.push(i);
  });
  if (starts.length <= keep) return messages;
  return messages.slice(starts[starts.length - keep]);
}

/** Sunucu toplam araç sonucunu 24 bin karakterle sınırlar; istemci kendine daha dar bir pay bırakır. */
export const MAX_RESULT_CHARS = 20_000;

function resultChars(m: Turn): number {
  if (!Array.isArray(m.content)) return 0;
  return (m.content as { type?: string; content?: unknown }[]).reduce((n, b) => n + (b.type === "tool_result" && typeof b.content === "string" ? b.content.length : 0), 0);
}

/**
 * Toplam araç sonucu `max` karakteri aşıyorsa en eski alışverişleri atar (kesim yine düz kullanıcı mesajında).
 * Son alışveriş (şimdiki soru) her zaman kalır.
 */
export function trimBySize<T extends Turn>(messages: T[], max: number = MAX_RESULT_CHARS): T[] {
  let out = messages;
  while (out.reduce((n, m) => n + resultChars(m), 0) > max) {
    const starts = out.flatMap((m, i) => (m.role === "user" && typeof m.content === "string" ? [i] : []));
    const next = starts[1];
    if (next === undefined) return out;
    out = out.slice(next);
  }
  return out;
}

/**
 * Döngü bir araç sonucu turuyla bittiyse (cevap yazılmadan) o yarım alışverişi atar; yoksa sonraki soru rol sırası
 * denetimine takılırdı. Önceki tamamlanmış alışverişler kalır.
 */
export function dropIncompleteExchange<T extends Turn>(messages: T[]): T[] {
  const last = messages[messages.length - 1];
  if (!last || last.role === "assistant" || typeof last.content === "string") return messages;
  const starts = messages.flatMap((m, i) => (m.role === "user" && typeof m.content === "string" ? [i] : []));
  return messages.slice(0, starts[starts.length - 1] ?? 0);
}
