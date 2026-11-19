"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Ctx } from "@/domain/context";
import { approvePurchaseOrder, submitPurchaseOrder } from "@/domain/purchasing/approval";
import { cancelPurchaseOrder, createFromSuggestion, removePurchaseLine, updatePurchaseLine } from "@/domain/purchasing/orders";
import { getPurchaseOrder, getSupplier, listPurchaseOrders, listSuppliers, type PurchaseOrderFilter } from "@/domain/purchasing/queries";
import { purchaseSuggestions, waitingWorkOrderCount } from "@/domain/purchasing/suggestions";
import { createSupplier, type NewSupplier, removeSupplierItem, setSupplierItem, updateSupplier } from "@/domain/purchasing/suppliers";
import { approvalThresholds } from "@/domain/settings";
import { useDb } from "@/shell/db-context";
import { useAction } from "@/shell/useAction";

const KEY = "purchasing";

export function useSuggestions() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "suggestions"], queryFn: () => purchaseSuggestions(db) });
}

export function useWaitingWorkOrderCount() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "waiting-work-orders"], queryFn: () => waitingWorkOrderCount(db) });
}

export function useSuppliers(filter: { search?: string } = {}) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "suppliers", filter], queryFn: () => listSuppliers(db, filter), placeholderData: keepPreviousData });
}

export function useSupplier(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "supplier", id], queryFn: () => getSupplier(db, id ?? ""), enabled: id !== null });
}

export function usePurchaseOrders(filter: Omit<PurchaseOrderFilter, "now"> = {}, enabled = true) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "orders", filter], queryFn: () => listPurchaseOrders(db, filter), placeholderData: keepPreviousData, enabled });
}

export function usePurchaseOrder(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "order", id], queryFn: () => getPurchaseOrder(db, id ?? ""), enabled: id !== null });
}

/** Onay eşikleri (yalnızca okunur): onay penceresindeki "50.000 TL eşiğini aşıyor" metni ve taslaktaki kademe tahmini. */
export function useApprovalThresholds() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "thresholds"], queryFn: () => approvalThresholds(db) });
}

export const useCreateFromSuggestion = () => useAction(createFromSuggestion);
export const useCreateSupplier = () => useAction(createSupplier);
export const useUpdateSupplier = () => useAction((ctx: Ctx, input: { id: string; patch: Partial<NewSupplier> }) => updateSupplier(ctx, input.id, input.patch));
export const useSetSupplierItem = () => useAction(setSupplierItem);
export const useRemoveSupplierItem = () => useAction(removeSupplierItem);
export const useSubmitPurchaseOrder = () => useAction(submitPurchaseOrder);
export const useApprovePurchaseOrder = () => useAction(approvePurchaseOrder);
export const useCancelPurchaseOrder = () => useAction(cancelPurchaseOrder);
export const useUpdatePurchaseLine = () => useAction(updatePurchaseLine);
export const useRemovePurchaseLine = () => useAction(removePurchaseLine);
