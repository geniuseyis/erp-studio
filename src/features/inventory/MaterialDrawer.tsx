"use client";

import Link from "next/link";
import { useState } from "react";
import type { MaterialRow } from "@/domain/inventory/queries";
import { can } from "@/domain/permissions";
import { formatMoney, formatNumber, formatQty, unitLabel } from "@/domain/units";
import { useSession } from "@/shell/session";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Drawer } from "@/ui/Drawer";
import { DetailItem } from "@/ui/DrawerParts";
import { formatDateTime, formatSignedQty } from "@/ui/format";
import { ArrowRightIcon, ClockIcon, EditIcon, MinusIcon, PlusIcon, ShelfIcon, TagIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { CategorySwatch } from "./CategorySwatch";
import { useMaterial, useMovements } from "./hooks";
import { CATEGORY_LABEL, MOVEMENT_LABEL, stockScale, stockTone } from "./labels";
import { MaterialForm } from "./MaterialForm";
import { MovementIcon } from "./MovementIcon";
import { StockActionDialog } from "./StockActionDialog";

type Action = "receipt" | "issue" | "edit" | null;

/** Malzeme ayrıntısı: stok cetveli, kart bilgileri, son hareketler ve yetkiye göre işlemler. */
export function MaterialDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const material = useMaterial(id);
  const movements = useMovements({ materialId: id, limit: 10 });
  const [action, setAction] = useState<Action>(null);
  const m = material.data;

  const canExecute = user ? can(user, "inventory", "execute") : false;
  const canWrite = user ? can(user, "inventory", "write") : false;

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => !open && onClose()}
        title={m?.name ?? (material.isPending ? "Yükleniyor" : "Malzeme bulunamadı")}
        badge={m ? <CategorySwatch category={m.category} size="lg" /> : undefined}
        subtitle={
          m ? (
            <>
              <span className="tabular font-semibold text-hero-fg">{m.code}</span>
              <span>{CATEGORY_LABEL[m.category]}</span>
              {m.isCritical ? <StatusChip tone="danger">Kritik</StatusChip> : <StatusChip tone="ok">Yeterli</StatusChip>}
            </>
          ) : undefined
        }
        hero={m ? <StockLevel material={m} onDark /> : undefined}
        footer={
          m && (canExecute || canWrite) ? (
            <>
              {canExecute ? (
                <>
                  <Button variant="primary" icon={<PlusIcon />} onClick={() => setAction("receipt")}>
                    Stok girişi
                  </Button>
                  <Button icon={<MinusIcon />} onClick={() => setAction("issue")}>
                    Stok çıkışı
                  </Button>
                </>
              ) : null}
              {canWrite ? (
                <Button variant="ghost" icon={<EditIcon />} className="ml-auto" onClick={() => setAction("edit")}>
                  Düzenle
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {m ? (
          <div className="grid gap-6">
            <dl className="grid grid-cols-2 gap-2.5">
              <DetailItem label="Eldeki">{formatQty(m.onHandMilli, m.unit)}</DetailItem>
              <DetailItem label="Ayrılmış">{formatQty(m.reservedMilli, m.unit)}</DetailItem>
              <DetailItem label="Yeniden sipariş noktası">{formatQty(m.reorderPointMilli, m.unit)}</DetailItem>
              <DetailItem label="Güvenlik stoğu">{formatQty(m.safetyStockMilli, m.unit)}</DetailItem>
              <DetailItem label="Ortalama maliyet" icon={<TagIcon size={14} />}>
                {formatMoney(m.avgCostKurus)}
              </DetailItem>
              <DetailItem label="Tedarik süresi" icon={<ClockIcon size={14} />}>
                {m.leadTimeDays} gün
              </DetailItem>
              <DetailItem label="Raf" icon={<ShelfIcon size={14} />}>
                {m.shelf || "Belirtilmemiş"}
              </DetailItem>
              <DetailItem label="Kullanılabilir">{formatQty(m.availableMilli, m.unit)}</DetailItem>
            </dl>

            <section className="grid gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-semibold">Son hareketler</h3>
                <Link
                  href={`/stok/hareketler?malzeme=${m.id}`}
                  className="group inline-flex items-center gap-1 text-sm font-semibold text-accent underline-offset-4 hover:underline"
                >
                  Tüm hareketleri gör
                  <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
              {movements.data && movements.data.length === 0 ? <p className="text-fg-muted">Bu malzemede henüz hareket yok.</p> : null}
              <ul className="relative grid">
                {/* Zaman çizgisi */}
                <span aria-hidden="true" className="absolute top-4 bottom-4 left-[17px] w-px bg-line" />
                {(movements.data ?? []).map((mv, i) => {
                  const delta = mv.deltaOnHandMilli !== 0 ? mv.deltaOnHandMilli : mv.deltaReservedMilli;
                  return (
                    <li
                      key={mv.id}
                      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2 animate-[row-in_420ms_var(--ease-spring)_both]"
                      style={{ animationDelay: `${120 + i * 40}ms` }}
                    >
                      <MovementIcon type={mv.type} />
                      <span className="grid min-w-0">
                        <span className="font-semibold">{MOVEMENT_LABEL[mv.type]}</span>
                        <span className="truncate text-sm text-fg-muted">
                          {formatDateTime(mv.createdAt)}, {mv.userName}
                          {mv.note ? `: ${mv.note}` : ""}
                        </span>
                      </span>
                      <span className={cn("tabular font-semibold whitespace-nowrap", delta > 0 && "text-ok")}>{formatSignedQty(delta, mv.unit)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        ) : material.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="w-2/3" />
            <Skeleton />
            <Skeleton className="w-1/2" />
          </div>
        ) : (
          <p className="text-fg-muted">Bu malzeme silinmiş ya da adres hatalı olabilir.</p>
        )}
      </Drawer>

      {m && (action === "receipt" || action === "issue") ? <StockActionDialog kind={action} material={m} onClose={() => setAction(null)} /> : null}
      {m && action === "edit" ? <MaterialForm material={m} onClose={() => setAction(null)} /> : null}
    </>
  );
}

/** Stok cetveli: büyük kullanılabilir rakamı, cetvel ve sipariş noktasına uzaklık. `onDark` ceviz bandı içindir. */
export function StockLevel({ material: m, onDark = false }: { material: MaterialRow; onDark?: boolean }) {
  const label = `Kullanılabilir ${formatQty(m.availableMilli, m.unit)}, yeniden sipariş noktası ${formatQty(m.reorderPointMilli, m.unit)}`;
  const muted = onDark ? "text-hero-fg-muted" : "text-fg-muted";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={cn("text-sm", muted)}>Kullanılabilir</p>
          <p className="tabular font-display text-[2.5rem] leading-none font-semibold tracking-tight">
            {formatNumber(m.availableMilli / 1000)}
            <span className={cn("ml-1.5 text-lg font-medium", muted)}>{unitLabel(m.unit)}</span>
          </p>
        </div>
        <div className="text-right">
          <p className={cn("text-sm", muted)}>Stok değeri</p>
          <p className="tabular font-display text-xl font-semibold">{formatMoney(m.stockValueKurus)}</p>
        </div>
      </div>
      <Meter value={m.availableMilli} max={stockScale(m)} mark={m.reorderPointMilli} tone={stockTone(m)} label={label} />
      <p className={cn("text-sm", muted)}>
        {m.isCritical
          ? `Kullanılabilir stok sipariş noktasının ${formatQty(m.reorderPointMilli - m.availableMilli, m.unit)} altında.`
          : `Kullanılabilir stok sipariş noktasının ${formatQty(m.availableMilli - m.reorderPointMilli, m.unit)} üstünde.`}
      </p>
    </div>
  );
}
