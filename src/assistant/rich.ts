export type RichToken = { type: "text"; text: string } | { type: "link"; label: string; href: string } | { type: "bold"; text: string };

// Bağlantı yalnızca uygulama içi yoldur: "/" ile başlar, ama "//" (başka site) ya da "/\" (tarayıcıda "//" gibi okunur) olamaz.
const RICH = /\[([^\]]+)\]\((\/(?![/\\])[^)\s]*)\)|\*\*([^*]+)\*\*/g;

/** Cevaptaki uygulama içi bağlantıları ([KOD](/yol?ac=…)) ve **kalın** yazıyı ayırır; başka bağlantı türü düz metin kalır. */
export function parseRich(text: string): RichToken[] {
  const out: RichToken[] = [];
  let last = 0;
  for (const m of text.matchAll(RICH)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    if (m[2]) out.push({ type: "link", label: m[1]!, href: m[2] });
    else out.push({ type: "bold", text: m[3]! });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}
