// Hızlı mod için serbest yazı eşleştiricisi: kesin sözcük istemez. Yazıyı normalleştirir, kayıt kodlarını yakalar,
// seçenekleri eş anlamlı söyleyişlerle ve yazım hatası payıyla puanlar. Eminse niyeti döner; değilse "bunu mu
// demek istediniz?" için en olası seçenekleri.
import { searchKey } from "@/domain/text";
import { FALLBACK_IDS, type IntentDef } from "./intents";

export type CodeEntity = "order" | "workorder" | "po" | "material" | "supplier" | "product" | "customer";

export type Match =
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "menu" }
  | { kind: "code"; code: string; entity: CodeEntity }
  | { kind: "intent"; id: string; term?: string }
  | { kind: "unsure"; suggestions: string[]; term?: string };

/** `pendingSlot` varken serbest yazı boşluğu doldurur. */
export type Route = Match | { kind: "slot_fill"; id: string; term: string };

const CONFIDENT = 0.65;
const MARGIN = 0.12;
const SUGGEST_MIN = 0.3;
const FACTOR = [0, 0.7, 1, 1.15];

const GREETING = ["merhaba", "selam", "selamlar", "gunaydin", "hey", "hello", "slm", "mrb", "iyi gunler", "iyi aksamlar", "iyi calismalar", "kolay gelsin", "naber", "nasilsin", "hosgeldin"];
const THANKS = ["tesekkur", "tesekkurler", "tesekkur ederim", "sagol", "sag ol", "saol", "eyvallah", "mersi", "super", "harika", "tamam", "oldu", "anladim", "peki"];
const MENU = ["menu", "ana menu", "menuyu ac", "baslat", "bastan", "yardim", "yardim et", "ne yapabilirsin", "neler yapabilirsin", "ne yapabiliyorsun", "geri", "geri don", "ana sayfa", "secenekler"];
const POLITE = new Set(["ben", "bir", "cok", "size", "lutfen", "biraz", "ve", "sana", "de", "da", "ya", "bana", "goster", "ac", "git"]);

const STOP = new Set([
  "bana", "goster", "bak", "listele", "lutfen", "ne", "nedir", "kadar", "var", "mi", "mu", "durumu", "durum", "hangi", "hangileri", "neler", "bir", "bu", "su", "ve", "ile", "icin", "olan", "acaba",
  "istiyorum", "bilgi", "bilgisi", "ver", "verir", "misin", "musun", "kac", "kaldi", "nerede", "kim", "de", "da", "ya", "benim", "olanlar", "var", "yok", "ama", "gibi", "bakar", "bakalim", "ogren", "ogrenmek",
]);

const DOC_CODE = /\b(sip|ie|sas)[\s-]?(\d{4})[\s-]?(\d{1,4})\b/;
const ITEM_CODE = /\b(mlz|ted|urn|mus)[\s-]?(\d{1,4})\b/;
const CODE_ENTITY: Record<string, CodeEntity> = { sip: "order", ie: "workorder", sas: "po", mlz: "material", ted: "supplier", urn: "product", mus: "customer" };

/** Küçük harf, Türkçe harfsiz, noktalamasız ve tek boşluklu anahtar. */
export function normalize(text: string): string {
  return searchKey(text).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Bitişik yer değiştirmeyi tek hata sayan düzenleme uzaklığı (OSA). */
export function editDistance(a: string, b: string): number {
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (prev2[j - 2] ?? Infinity) + 1);
      cur[j] = v;
    }
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length]!;
}

/** Yazılan sözcüğün anahtar sözcüğe benzerliği: 1 aynı, 0,95 ek almış, 0,8 yazım hatalı, 0 ilgisiz. */
export function tokenScore(word: string, key: string): number {
  if (word === key) return 1;
  if (key.length >= 4 && word.startsWith(key)) return 0.95;
  if (word.length < 4 || key.length < 4) return 0;
  const tol = word.length >= 8 ? 2 : 1;
  if (Math.abs(word.length - key.length) <= tol && editDistance(word, key) <= tol) return 0.8;
  // Ek almış ve yanlış yazılmış: ilk harfler anahtarın uzunluğunda karşılaştırılır.
  if (key.length >= 5 && word.length > key.length && editDistance(word.slice(0, key.length), key) <= 1) return 0.8;
  return 0;
}

type Compiled = { words: string[][] };
const compiled = new Map<string, Compiled[]>();
function compile(def: IntentDef): Compiled[] {
  let c = compiled.get(def.id);
  if (!c) {
    c = def.phrases.map((p) => ({ words: normalize(p).length ? p.split(/\s+/).map((w) => w.split("|").map(normalize)) : [] }));
    compiled.set(def.id, c);
  }
  return c;
}

/** Bir seçeneğin en iyi söyleyişinin puanı ve o söyleyişin kullandığı sözcük sıraları. */
export function scoreIntent(def: IntentDef, tokens: string[]): { score: number; used: Set<number> } {
  let best = { score: 0, used: new Set<number>() };
  for (const phrase of compile(def)) {
    const n = phrase.words.length;
    if (n === 0) continue;
    let sum = 0;
    const used = new Set<number>();
    for (const alts of phrase.words) {
      let top = 0;
      let at = -1;
      for (const alt of alts) {
        tokens.forEach((t, i) => {
          const s = tokenScore(t, alt);
          if (s > top) {
            top = s;
            at = i;
          }
        });
      }
      sum += top;
      if (top > 0 && at >= 0) used.add(at);
    }
    const score = (sum / n) * FACTOR[Math.min(n, 3)]!;
    if (score > best.score) best = { score, used };
  }
  return best;
}

function social(tokens: string[]): "greeting" | "thanks" | "menu" | null {
  if (tokens.length === 0 || tokens.length > 5) return null;
  const only = (list: string[]) => {
    const words = list.flatMap((p) => p.split(" "));
    const hit = (t: string) => words.some((w) => tokenScore(t, w) >= 0.8);
    // Yalnızca "ne" ya da "var" gibi işlev sözcüklerinin tuttuğu yazı selam ya da menü isteği sayılmaz.
    return tokens.every((t) => hit(t) || POLITE.has(t)) && tokens.some((t) => hit(t) && !STOP.has(t));
  };
  if (only(THANKS)) return "thanks";
  if (only(MENU)) return "menu";
  if (only(GREETING)) return "greeting";
  return null;
}

/** Yazıdaki kayıt kodu (SIP-, IE-, SAS-, MLZ-, TED-, URN-). */
export function detectCode(text: string): { code: string; entity: CodeEntity } | null {
  const key = searchKey(text);
  const doc = DOC_CODE.exec(key);
  if (doc) return { code: `${doc[1]!.toUpperCase()}-${doc[2]}-${doc[3]!.padStart(4, "0")}`, entity: CODE_ENTITY[doc[1]!]! };
  const item = ITEM_CODE.exec(key);
  if (item) return { code: `${item[1]!.toUpperCase()}-${item[2]!.padStart(4, "0")}`, entity: CODE_ENTITY[item[1]!]! };
  return null;
}

function fillTo3(ids: string[], allowed: IntentDef[]): string[] {
  const ok = new Set(allowed.map((a) => a.id));
  const out = [...ids];
  for (const f of FALLBACK_IDS) if (out.length < 3 && ok.has(f) && !out.includes(f)) out.push(f);
  return out.slice(0, 3);
}

/** Serbest yazıyı niyete çevirir. `allowed`: kullanıcının görebildiği seçenekler. */
export function matchText(text: string, allowed: IntentDef[]): Match {
  const tokens = normalize(text).split(" ").filter(Boolean);
  if (tokens.length === 0) return { kind: "menu" };
  const s = social(tokens);
  if (s) return { kind: s };
  const code = detectCode(text);
  if (code) return { kind: "code", ...code };

  const scored = allowed
    .map((def) => ({ def, ...scoreIntent(def, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  // Emin olmak için söyleyişin en az bir içerik sözcüğüne (işlev sözcüğü değil) denk gelmesi gerekir:
  // "ne var" ya da "durum nedir" tek başına bir seçeneği seçtirmez, "stok durum nedir" stoğu öne çıkarır.
  const ranked = scored.filter((r) => [...r.used].some((i) => !STOP.has(tokens[i]!)));
  const [best, second] = ranked;
  const leftover = (used: Set<number>) =>
    tokens
      .filter((t, i) => !used.has(i) && !STOP.has(t) && t.length >= 2)
      .join(" ");
  if (best && best.score >= CONFIDENT && (!second || best.score - second.score >= MARGIN)) {
    const term = best.def.kind === "slot" ? leftover(best.used) : "";
    return term ? { kind: "intent", id: best.def.id, term } : { kind: "intent", id: best.def.id };
  }
  const term = leftover(best?.used ?? new Set());
  const suggestions = fillTo3(
    scored.filter((r) => r.score >= SUGGEST_MIN).slice(0, 3).map((r) => r.def.id),
    allowed,
  );
  return term ? { kind: "unsure", suggestions, term } : { kind: "unsure", suggestions };
}

/** Boşluk bekleniyorsa (`pendingSlot`) serbest yazı onu doldurur; menü, selam ve kayıt kodu yine önceliklidir. */
export function routeText(text: string, allowed: IntentDef[], pendingSlot?: string | null): Route {
  if (pendingSlot) {
    const tokens = normalize(text).split(" ").filter(Boolean);
    const s = social(tokens);
    if (s) return { kind: s };
    const code = detectCode(text);
    if (code) return { kind: "code", ...code };
    const term = text.trim();
    if (term) return { kind: "slot_fill", id: pendingSlot, term };
  }
  return matchText(text, allowed);
}
