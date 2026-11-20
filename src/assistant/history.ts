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
