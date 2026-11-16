"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { Ctx } from "@/domain/context";
import { createUser, listUsers, resetPassword, setUserActive, updateUser, type UserPatch } from "@/domain/users";
import { announceChange, useDb } from "@/shell/db-context";
import { useCtx } from "@/shell/useCtx";

export function useUsers() {
  const { db } = useDb();
  return useQuery({ queryKey: ["users", "list"], queryFn: () => listUsers(db), placeholderData: keepPreviousData });
}

/** Bir kullanıcı servisini çağırır; başarıda bütün sorgular yenilenir ve diğer sekmelere haber verilir. */
function useAction<I, O>(run: (ctx: Ctx, input: I) => Promise<O>) {
  const ctx = useCtx();
  return useMutation({ mutationFn: (input: I) => run(ctx(), input), onSuccess: announceChange });
}

export const useCreateUser = () => useAction(createUser);
export const useUpdateUser = () => useAction((ctx: Ctx, input: { id: string; patch: UserPatch }) => updateUser(ctx, input.id, input.patch));
export const useSetUserActive = () => useAction((ctx: Ctx, input: { id: string; active: boolean }) => setUserActive(ctx, input.id, input.active));
export const useResetPassword = () => useAction((ctx: Ctx, input: { id: string; password: string }) => resetPassword(ctx, input.id, input.password));
