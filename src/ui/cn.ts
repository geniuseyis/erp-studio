/** Sınıf adlarını birleştirir; boş, false ve undefined değerleri atlar. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
