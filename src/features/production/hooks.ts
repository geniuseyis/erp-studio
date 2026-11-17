"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getProduct,
  getWorkOrder,
  listProducts,
  listStations,
  listWorkOrders,
  type ProductFilter,
  stationQueue,
  type WorkOrderFilter,
} from "@/domain/production/queries";
import type { Ctx } from "@/domain/context";
import { finishCurrentStep, planWorkOrder, retryMaterials, startNextStep } from "@/domain/production/workOrders";
import { useDb } from "@/shell/db-context";
import { useAction } from "@/shell/useAction";

const KEY = "production";

export function useProducts(filter: ProductFilter = {}) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "products", filter], queryFn: () => listProducts(db, filter), placeholderData: keepPreviousData });
}

export function useProduct(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "product", id], queryFn: () => getProduct(db, id ?? ""), enabled: id !== null });
}

export function useWorkOrders(filter: WorkOrderFilter = {}) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "workOrders", filter], queryFn: () => listWorkOrders(db, filter), placeholderData: keepPreviousData });
}

export function useWorkOrder(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "workOrder", id], queryFn: () => getWorkOrder(db, id ?? ""), enabled: id !== null });
}

export function useStations() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "stations"], queryFn: () => listStations(db), staleTime: Number.POSITIVE_INFINITY });
}

/** Bütün istasyonların kuyrukları tek sorguda: seçili istasyonun kartları ve çiplerdeki sayılar buradan. */
export function useStationQueues(codes: readonly string[]) {
  const { db } = useDb();
  return useQuery({
    queryKey: [KEY, "queues", codes],
    queryFn: async () => {
      const queues = await Promise.all(codes.map((code) => stationQueue(db, code)));
      return new Map(codes.map((code, i) => [code, queues[i] ?? []]));
    },
    enabled: codes.length > 0,
    placeholderData: keepPreviousData,
  });
}

export const usePlanWorkOrder = () => useAction(planWorkOrder);
export const useRetryMaterials = () => useAction(retryMaterials);
/** `seq`: ekranın gösterdiği adım; başka tablet ilerlettiyse servis reddeder. */
type StepInput = { workOrderId: string; seq: number };
export const useStartStep = () => useAction((ctx: Ctx, i: StepInput) => startNextStep(ctx, i.workOrderId, i.seq));
export const useFinishStep = () => useAction((ctx: Ctx, i: StepInput) => finishCurrentStep(ctx, i.workOrderId, i.seq));
