"use client";

import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { Ctx } from "@/domain/context";
import { isDomainError } from "@/domain/errors";
import { useToast } from "@/ui/Toast";
import { announceChange } from "./db-context";
import { useCtx } from "./useCtx";

/**
 * Bir iş kuralını çağırır; başarıda bütün sorgular yenilenir ve diğer sekmelere haber verilir.
 * `mutateAsync` ancak yenileme bitip yeni veri ekrana iletildiğinde çözülür.
 */
export function useAction<I, O>(run: (ctx: Ctx, input: I) => Promise<O>) {
  const ctx = useCtx();
  return useMutation({ mutationFn: (input: I) => run(ctx(), input), onSuccess: () => announceChange() });
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** Hatayı kullanıcıya gösterilecek Türkçe iletiye çevirir. İş kuralı iletileri olduğu gibi, diğerleri genel iletiyle gösterilir. */
export function errorMessage(error: unknown): string {
  if (!isDomainError(error)) return "Beklenmeyen bir hata oluştu.";
  if (error.code === "FORBIDDEN") return "Bu işlem için yetkiniz yok.";
  if (error.code === "LOGIN_FAILED") return "E-posta ya da parola hatalı.";
  return sentence(error.message);
}

/**
 * Çift tıklama korumalı işlem çalıştırıcı. Aynı anda tek işlem: ilki sürerken gelen istek yok sayılır, çift tıklamanın
 * ikinci tıklaması (`event.detail > 1`) da. `busy`, işlem ve ardından gelen veri yenilemesi (useAction) bitene dek
 * dolu kalır; böylece aynı yerde duran düğme (Başla → Bitti) eski veriyle açılıp ters işlemi tetiklemez.
 * Hata bildirim olarak gösterilir. İşlem başarıyla bittiyse true döner.
 */
export function useGuardedRun<K extends string>() {
  const toast = useToast();
  const running = useRef(false);
  const [busy, setBusy] = useState<K | null>(null);

  const run = useCallback(
    async (kind: K, work: () => Promise<void>, event?: { detail: number }): Promise<boolean> => {
      if (running.current || (event !== undefined && event.detail > 1)) return false;
      running.current = true;
      setBusy(kind);
      try {
        await work();
        return true;
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [toast],
  );

  return { busy, run };
}
