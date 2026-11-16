"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Ctx } from "@/domain/context";
import { createUser, listUsers, resetPassword, setUserActive, updateUser, type UserPatch } from "@/domain/users";
import { useDb } from "@/shell/db-context";
import { useAction } from "@/shell/useAction";

export function useUsers() {
  const { db } = useDb();
  return useQuery({ queryKey: ["users", "list"], queryFn: () => listUsers(db), placeholderData: keepPreviousData });
}

export const useCreateUser = () => useAction(createUser);
export const useUpdateUser = () => useAction((ctx: Ctx, input: { id: string; patch: UserPatch }) => updateUser(ctx, input.id, input.patch));
export const useSetUserActive = () => useAction((ctx: Ctx, input: { id: string; active: boolean }) => setUserActive(ctx, input.id, input.active));
export const useResetPassword = () => useAction((ctx: Ctx, input: { id: string; password: string }) => resetPassword(ctx, input.id, input.password));
