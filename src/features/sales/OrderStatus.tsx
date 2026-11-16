import type { OrderRow } from "@/domain/sales/queries";
import type { OrderStatus } from "@/domain/sales/types";
import { StatusChip } from "@/ui/StatusChip";
import { formatDue, ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "./labels";

/** Durum çipi ve malzeme bekliyorsa yanında ikinci uyarı çipi. Liste, sipariş ve müşteri çekmecesi ortak kullanır. */
export function OrderStatusChips({ status, waitingMaterial }: { status: OrderStatus; waitingMaterial: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusChip tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</StatusChip>
      {waitingMaterial ? <StatusChip tone="warn">Malzeme bekliyor</StatusChip> : null}
    </span>
  );
}

/** Termin günü; gecikmişse kırmızı ve "gecikti" çipiyle. */
export function DueDate({ order }: { order: Pick<OrderRow, "dueAt" | "overdue"> }) {
  return order.overdue ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="tabular font-semibold text-danger">{formatDue(order.dueAt)}</span>
      <StatusChip tone="danger" className="h-5 px-2">
        gecikti
      </StatusChip>
    </span>
  ) : (
    <span className="tabular whitespace-nowrap">{formatDue(order.dueAt)}</span>
  );
}
