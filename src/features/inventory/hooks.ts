"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { Ctx } from "@/domain/context";
import { approveCount, cancelCount, createCount, setCountLine } from "@/domain/inventory/counts";
import { issueStock, receiveStock } from "@/domain/inventory/ledger";
import { createMaterial, updateMaterial, type EditableMaterial } from "@/domain/inventory/materials";
import {
  getCount,
  getMaterial,
  inventorySummary,
  listCounts,
  listMaterials,
  listMovements,
  type MaterialFilter,
  type MovementFilter,
} from "@/domain/inventory/queries";
import { announceChange, useDb } from "@/shell/db-context";
import { useCtx } from "@/shell/useCtx";

const KEY = "inventory";

export function useMaterials(filter: MaterialFilter = {}) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "materials", filter], queryFn: () => listMaterials(db, filter), placeholderData: keepPreviousData });
}

export function useMaterial(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "material", id], queryFn: () => getMaterial(db, id ?? ""), enabled: id !== null });
}

export function useMovements(filter: MovementFilter = {}, enabled = true) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "movements", filter], queryFn: () => listMovements(db, filter), placeholderData: keepPreviousData, enabled });
}

export function useCounts() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "counts"], queryFn: () => listCounts(db) });
}

export function useCount(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "count", id], queryFn: () => getCount(db, id ?? ""), enabled: id !== null });
}

export function useInventorySummary() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "summary"], queryFn: () => inventorySummary(db) });
}

/** Bir iş kuralını çağırır; başarıda bütün sorgular yenilenir ve diğer sekmelere haber verilir. */
function useAction<I, O>(run: (ctx: Ctx, input: I) => Promise<O>) {
  const ctx = useCtx();
  return useMutation({ mutationFn: (input: I) => run(ctx(), input), onSuccess: announceChange });
}

export const useReceiveStock = () => useAction(receiveStock);
export const useIssueStock = () => useAction(issueStock);
export const useCreateMaterial = () => useAction(createMaterial);
export const useUpdateMaterial = () =>
  useAction((ctx: Ctx, input: { id: string; patch: Partial<EditableMaterial> }) => updateMaterial(ctx, input.id, input.patch));
export const useCreateCount = () => useAction(createCount);
export const useSetCountLine = () => useAction(setCountLine);
export const useApproveCount = () => useAction(approveCount);
export const useCancelCount = () => useAction(cancelCount);
