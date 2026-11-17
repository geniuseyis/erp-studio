"use client";

import type { ProductDetail } from "@/domain/production/queries";
import type { ProductFinish } from "@/domain/production/types";
import { formatMoney, formatNumber, formatQty } from "@/domain/units";
import { CategorySwatch } from "@/features/inventory/CategorySwatch";
import { FINISH_LABEL } from "@/features/sales/labels";
import { entityHistory, useHistory } from "@/shell/useHistory";
import { cn } from "@/ui/cn";
import { Drawer } from "@/ui/Drawer";
import { DetailItem, DrawerBadge } from "@/ui/DrawerParts";
import { HistoryList } from "@/ui/HistoryList";
import { BoxIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/Skeleton";
import { useProduct } from "./hooks";
import { formatMinutes, unitNeedMilli } from "./labels";

/** Kaplama çipi: yanında kaplamanın küçük numunesi (ahşapta masif damarı, beyazda düz yüzey). Durum rengi taşımaz. */
export function FinishChip({ finish }: { finish: ProductFinish }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs font-semibold whitespace-nowrap text-fg ring-1 ring-line ring-inset">
      <span aria-hidden="true" className={cn("size-3 rounded-full ring-1 ring-line-strong", finish === "ahsap" ? "swatch-masif" : "bg-white")} />
      {FINISH_LABEL[finish]}
    </span>
  );
}

const mm = (n: number) => formatNumber(n);
const productHistory = entityHistory("product");

/** Ürün ayrıntısı: ölçüler, fiyat ve maliyet, reçete (bir adet için) ve atölye rotası. */
export function ProductDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const product = useProduct(id);
  const history = useHistory("product", id, productHistory);
  const p = product.data;

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={p?.name ?? (product.isPending ? "Yükleniyor" : "Ürün bulunamadı")}
      badge={
        p ? (
          <DrawerBadge tone="neutral">
            <BoxIcon size={22} />
          </DrawerBadge>
        ) : undefined
      }
      subtitle={
        p ? (
          <>
            <span className="tabular font-semibold text-hero-fg">{p.code}</span>
            <span>{p.collection}</span>
            <FinishChip finish={p.finish} />
            {p.active ? null : <span>Satışta değil</span>}
          </>
        ) : undefined
      }
      hero={p ? <ProductHero product={p} /> : undefined}
    >
      {p ? (
        <div className="grid gap-6">
          <dl className="grid grid-cols-2 gap-2.5">
            <DetailItem label="Ölçüler (G × D × Y)" wide>
              {mm(p.widthMm)} × {mm(p.depthMm)} × {mm(p.heightMm)} mm
            </DetailItem>
            <DetailItem label="Kategori">{p.category}</DetailItem>
            <DetailItem label="KDV oranı">KDV %{p.vatRate}</DetailItem>
            <DetailItem label="Mamul eldeki">{formatNumber(p.onHandMilli / 1000)} adet</DetailItem>
            <DetailItem label="Ayrılmış">{formatNumber(p.reservedMilli / 1000)} adet</DetailItem>
          </dl>
          <Bom product={p} />
          <Routing product={p} />
          <HistoryList {...history} />
        </div>
      ) : product.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="w-2/3" />
          <Skeleton />
          <Skeleton className="w-1/2" />
        </div>
      ) : (
        <p className="text-fg-muted">Bu ürün silinmiş ya da adres hatalı olabilir.</p>
      )}
    </Drawer>
  );
}

/** Birim maliyet katalogdaki gibi malzeme + işçilik ve genel giderdir; brüt kâr bu tam maliyetle hesaplanır. */
function ProductHero({ product: p }: { product: ProductDetail }) {
  const margin = p.priceKurus > 0 ? Math.round(((p.priceKurus - p.unitCostKurus) / p.priceKurus) * 100) : 0;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-hero-fg-muted">Fiyat, KDV hariç</p>
        <p className="tabular font-display text-[2.25rem] leading-none font-semibold tracking-tight">{formatMoney(p.priceKurus)}</p>
      </div>
      <div className="text-right">
        <p className="text-sm text-hero-fg-muted">Birim maliyet</p>
        <p className="tabular font-display text-xl font-semibold">{formatMoney(p.unitCostKurus)}</p>
        <p className="tabular text-sm text-hero-fg-muted">Brüt kâr %{margin}</p>
        <p className="tabular text-sm text-hero-fg-muted">Malzeme maliyeti {formatMoney(p.materialCostKurus)}</p>
      </div>
    </div>
  );
}

function Bom({ product: p }: { product: ProductDetail }) {
  const headingId = `bom-${p.id}`;
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="text-lg font-semibold">
          Reçete <span className="tabular text-base font-medium text-fg-muted">({p.bom.length})</span>
        </h3>
        <span className="text-sm text-fg-muted">Bir adet için</span>
      </div>
      {p.bom.length === 0 ? (
        <p className="text-fg-muted">Bu ürünün reçetesi yok.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-line ring-inset">
          <table aria-label="Reçete" className="w-full border-collapse text-sm">
            <thead className="bg-surface-2/70 text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Malzeme
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Miktar
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Fire
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Kullanılabilir
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {p.bom.map((b) => {
                const short = b.availableMilli < unitNeedMilli(b);
                return (
                  <tr key={b.materialId} className="border-t border-line align-top">
                    <td className="px-3 py-2.5">
                      <span className="flex min-w-40 items-center gap-2.5">
                        <CategorySwatch category={b.category} size="sm" />
                        <span className="grid min-w-0">
                          <span className="font-semibold break-words">{b.name}</span>
                          <span className="text-xs text-fg-muted">{b.code}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatQty(b.qtyMilli, b.unit)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-fg-muted">%{formatNumber(b.scrapPermille / 10, 1)}</td>
                    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap", short && "font-semibold text-danger")}>
                      {formatQty(b.availableMilli, b.unit)}
                      {short ? <span className="block text-xs font-medium">yetmiyor</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Routing({ product: p }: { product: ProductDetail }) {
  const headingId = `route-${p.id}`;
  const total = p.routing.reduce((n, r) => n + r.minutesPerUnit, 0);
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="text-lg font-semibold">
          Rota
        </h3>
        <span className="tabular text-sm text-fg-muted">Toplam {formatMinutes(total)}/adet</span>
      </div>
      {p.routing.length === 0 ? (
        <p className="text-fg-muted">Bu ürünün rotası yok.</p>
      ) : (
        <ol aria-label="Rota" className="grid gap-2">
          {p.routing.map((r) => (
            <li key={r.seq} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-surface-2/70 px-3.5 py-2.5 ring-1 ring-line ring-inset">
              <span aria-hidden="true" className="tabular grid size-7 place-items-center rounded-full bg-surface text-sm font-semibold ring-1 ring-line-strong">
                {r.seq}
              </span>
              <span className="grid min-w-0">
                <span className="font-semibold">{r.stationName}</span>
                <span className="text-xs text-fg-muted">{r.stationCode}</span>
              </span>
              <span className="tabular font-semibold whitespace-nowrap">{formatMinutes(r.minutesPerUnit)}/adet</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
