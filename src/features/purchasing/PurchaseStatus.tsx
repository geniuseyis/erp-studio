import type { PurchaseOrderRow } from "@/domain/purchasing/queries";
import { StatusChip } from "@/ui/StatusChip";
import { PO_STATUS_LABEL, PO_STATUS_TONE } from "./labels";

/** Durum çipi; geciken açık siparişte yanında ikinci uyarı çipi. Liste ve çekmece ortak kullanır. */
export function PurchaseStatusChips({ status, late }: Pick<PurchaseOrderRow, "status" | "late">) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusChip tone={PO_STATUS_TONE[status]}>{PO_STATUS_LABEL[status]}</StatusChip>
      {late ? <StatusChip tone="danger">Gecikti</StatusChip> : null}
    </span>
  );
}
