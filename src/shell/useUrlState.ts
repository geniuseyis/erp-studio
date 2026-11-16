"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Süzgeç ve açık kayıt gibi ekran durumunu adres çubuğunda tutar: yenilemede kalır, bağlantı olarak paylaşılır.
 * Yazarken sayfa yeniden yüklenmez; geçmişe yeni kayıt eklenmez.
 */
export function useUrlState(): [URLSearchParams, (patch: Record<string, string | null>) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );
  return [params, set];
}
