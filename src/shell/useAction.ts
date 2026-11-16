"use client";

import { useMutation } from "@tanstack/react-query";
import type { Ctx } from "@/domain/context";
import { isDomainError } from "@/domain/errors";
import { announceChange } from "./db-context";
import { useCtx } from "./useCtx";

/** Bir iş kuralını çağırır; başarıda bütün sorgular yenilenir ve diğer sekmelere haber verilir. */
export function useAction<I, O>(run: (ctx: Ctx, input: I) => Promise<O>) {
  const ctx = useCtx();
  return useMutation({ mutationFn: (input: I) => run(ctx(), input), onSuccess: announceChange });
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** Hatayı kullanıcıya gösterilecek Türkçe iletiye çevirir. İş kuralı iletileri olduğu gibi, diğerleri genel iletiyle gösterilir. */
export function errorMessage(error: unknown): string {
  if (!isDomainError(error)) return "Beklenmeyen bir hata oluştu.";
  if (error.code === "FORBIDDEN") return "Bu işlem için yetkiniz yok.";
  if (error.code === "LOGIN_FAILED") return "E-posta ya da parola hatalı.";
  return sentence(error.message);
}
