"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Ctx } from "@/domain/context";
import { listProducts } from "@/domain/production/queries";
import { createCustomer, type NewCustomer, updateCustomer } from "@/domain/sales/customers";
import { addLine, cancelOrder, confirmOrder, createOrder, removeLine, shipOrder } from "@/domain/sales/orders";
import { type CustomerFilter, getCustomer, getOrder, listCustomers, listOrders, type OrderFilter, salesSummary } from "@/domain/sales/queries";
import { useDb } from "@/shell/db-context";
import { useAction } from "@/shell/useAction";

const KEY = "sales";

export function useOrders(filter: Omit<OrderFilter, "now"> = {}, enabled = true) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "orders", filter], queryFn: () => listOrders(db, filter), placeholderData: keepPreviousData, enabled });
}

export function useOrder(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "order", id], queryFn: () => getOrder(db, id ?? ""), enabled: id !== null });
}

export function useSalesSummary() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "summary"], queryFn: () => salesSummary(db, new Date()) });
}

export function useCustomers(filter: CustomerFilter = {}) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "customers", filter], queryFn: () => listCustomers(db, filter), placeholderData: keepPreviousData });
}

export function useCustomer(id: string | null) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "customer", id], queryFn: () => getCustomer(db, id ?? ""), enabled: id !== null });
}

/** Siparişe eklenebilen ürünler: yalnızca etkin olanlar, kod sırasıyla. */
export function useSellableProducts(enabled = true) {
  const { db } = useDb();
  return useQuery({
    queryKey: [KEY, "products"],
    queryFn: async () => (await listProducts(db)).filter((p) => p.active),
    enabled,
  });
}

export const useCreateOrder = () => useAction(createOrder);
export const useAddLine = () => useAction(addLine);
export const useRemoveLine = () => useAction(removeLine);
export const useConfirmOrder = () => useAction(confirmOrder);
export const useShipOrder = () => useAction(shipOrder);
export const useCancelOrder = () => useAction(cancelOrder);
export const useCreateCustomer = () => useAction(createCustomer);
export const useUpdateCustomer = () =>
  useAction((ctx: Ctx, input: { id: string; patch: Partial<NewCustomer> }) => updateCustomer(ctx, input.id, input.patch));
