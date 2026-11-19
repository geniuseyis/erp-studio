"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { listReceivable, listRecentReceipts } from "@/domain/purchasing/queries";
import { receiveGoods } from "@/domain/purchasing/receiving";
import { useDb } from "@/shell/db-context";
import { useAction } from "@/shell/useAction";

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

export const useReceiveStock = () => useAction(receiveStock);
export const useIssueStock = () => useAction(issueStock);
export const useCreateMaterial = () => useAction(createMaterial);
export const useUpdateMaterial = () =>
  useAction((ctx: Ctx, input: { id: string; patch: Partial<EditableMaterial> }) => updateMaterial(ctx, input.id, input.patch));
export const useCreateCount = () => useAction(createCount);
export const useSetCountLine = () => useAction(setCountLine);
export const useApproveCount = () => useAction(approveCount);
export const useCancelCount = () => useAction(cancelCount);

/** Mal kabule açık siparişler (gönderilmiş ve kısmi), geciken önce. */
export function useReceivable() {
  const { db } = useDb();
  return useQuery({ queryKey: ["purchasing", "receivable"], queryFn: () => listReceivable(db, new Date()) });
}

export function useRecentReceipts() {
  const { db } = useDb();
  return useQuery({ queryKey: ["purchasing", "receipts"], queryFn: () => listRecentReceipts(db, 10) });
}

export const useReceiveGoods = () => useAction(receiveGoods);