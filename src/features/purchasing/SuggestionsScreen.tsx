"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { can } from "@/domain/permissions";
import type { SuggestionGroup, SuggestionLine } from "@/domain/purchasing/suggestions";
import { formatMoney, formatQty } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { useGuardedRun } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { formatMoneyWhole } from "@/ui/format";
import { ArrowRightIcon, PlusIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { CountUp } from "@/ui/motion";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { useCreateFromSuggestion, useSuggestions } from "./hooks";
import { draftFromSuggestionText, REASON_LABEL, TIER_LABEL, TIER_TONE } from "./labels";

/** Satın alma önerisi: kritik stok ve malzeme bekleyen iş emirleri, tedarikçiye göre gruplanmış. Hiçbir şey yazmaz; "Taslak oluştur" yazar. */
export function SuggestionsScreen() {
  const { user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const suggestions = useSuggestions();
  const create = useCreateFromSuggestion();
  const { busy, run } = useGuardedRun<string>();
  const ask = useConfirm();
  const canWrite = user ? can(user, "purchasing", "write") : false;
  const groups = suggestions.data;

  const lines = (groups ?? []).flatMap((g) => g.lines);
  const waitingWorkOrders = new Set(lines.flatMap((l) => l.waitingWorkOrders)).size;
  const critical = lines.filter((l) => l.reasons.includes("kritik")).length;
  const total = (groups ?? []).reduce((sum, g) => sum + g.netMinor, 0);

  function draft(group: SuggestionGroup) {
    const supplierId = group.supplierId;
    if (!supplierId) return;
    void ask.confirm({
      title: "Taslak sipariş açılsın mı?",
      body: draftFromSuggestionText(group),
      confirmLabel: "Taslağı aç",
      action: () =>
        run(supplierId, async () => {
          const order = await create.mutateAsync(supplierId);
          toast.success(`${order.code} taslağı açıldı`);
          router.push(`/satin-alma/siparisler?ac=${order.id}`);
        }),
    });
  }

  return (
    <Page>
      <PageHeader
        title="Satın alma önerileri"
        description="Kritik stok ve malzeme bekleyen iş emirlerinden, tedarikçiye göre gruplanmış sipariş önerisi."
        stats={
          groups ? (
            <>
              <HeroStat index={0} label="Öneri grubu" value={<CountUp value={groups.length} format={String} />} hint="Tedarikçi başına bir sipariş" />
              <HeroStat index={1} label="Önerilen toplam" value={<CountUp value={total} format={formatMoneyWhole} />} hint="KDV hariç" />
              <HeroStat
                index={2}
                label="Malzeme bekleyen iş emri"
                tone={waitingWorkOrders > 0 ? "alert" : "default"}
                value={<CountUp value={waitingWorkOrders} format={String} />}
                hint="İş emirleri panosunu aç"
                href="/uretim/is-emirleri?gorunum=kanban"
              />
              <HeroStat index={3} label="Kritik kalem" tone={critical > 0 ? "alert" : "default"} value={<CountUp value={critical} format={String} />} hint="Sipariş noktasının altında" />
            </>
          ) : null
        }
      />

      {suggestions.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : groups && groups.length === 0 ? (
        <EmptyState title="Şu an önerilecek bir şey yok">Kritik stok ve malzeme bekleyen iş emri olduğunda öneriler burada görünür.</EmptyState>
      ) : (
        <div className="grid gap-4">
          {(groups ?? []).map((group) => (
            <GroupCard key={group.supplierId ?? "tanimsiz"} group={group} canWrite={canWrite} busy={busy} onDraft={() => draft(group)} />
          ))}
        </div>
      )}
      {ask.element}
    </Page>
  );
}

function GroupCard({ group, canWrite, busy, onDraft }: { group: SuggestionGroup; canWrite: boolean; busy: string | null; onDraft: () => void }) {
  const undefinedGroup = group.supplierId === null;
  const headingId = `grup-${group.supplierId ?? "tanimsiz"}`;
  return (
    <section aria-labelledby={headingId} className="grid gap-4 rounded-[22px] border border-line bg-surface p-4 shadow-card sm:p-5">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 id={headingId} className="font-display text-lg font-semibold break-words">
            {group.supplierName}
          </h2>
          <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            {group.supplierCode ? <span className="font-semibold">{group.supplierCode}</span> : null}
            {group.leadTimeDays !== null ? <span>Teslim süresi {group.leadTimeDays} iş günü</span> : <span>Bu malzemeler için fiyat veren tedarikçi yok</span>}
          </p>
        </div>
        {undefinedGroup ? null : (
          <div className="text-right">
            <p className="text-xs text-fg-muted">Grup toplamı, KDV hariç</p>
            <p className="tabular font-display text-xl font-semibold">{formatMoney(group.netMinor)}</p>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {undefinedGroup ? null : <StatusChip tone={TIER_TONE[group.requiredTier]}>{TIER_LABEL[group.requiredTier]}</StatusChip>}
        {undefinedGroup ? (
          canWrite ? (
            <Link href="/satin-alma/tedarikciler" className="group inline-flex min-h-11 items-center gap-1 font-semibold text-accent underline-offset-4 hover:underline">
              Tedarikçi tanımla
              <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <span className="text-sm text-fg-muted">Tedarikçiyi Satın Alma ekibi tanımlar.</span>
          )
        ) : canWrite ? (
          <Button variant="primary" icon={<PlusIcon />} className="ml-auto" loading={busy === group.supplierId} disabled={busy !== null} onClick={onDraft}>
            Taslak oluştur
          </Button>
        ) : null}
      </div>

      <ul aria-label={`${group.supplierName} önerilen kalemler`} className="grid gap-2">
        {group.lines.map((line) => (
          <LineRow key={line.materialId} line={line} priced={!undefinedGroup} />
        ))}
      </ul>
    </section>
  );
}

function LineRow({ line, priced }: { line: SuggestionLine; priced: boolean }) {
  const max = Math.max(line.reorderPointMilli * 2, line.availableMilli, 1);
  const critical = line.reasons.includes("kritik");
  return (
    <li className="grid gap-2 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="grid min-w-0">
          <span className="font-semibold break-words">{line.name}</span>
          <span className="tabular text-xs text-fg-muted">{line.code}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {line.reasons.map((r) => (
            <StatusChip key={r} tone={r === "kritik" ? "danger" : "warn"}>
              {REASON_LABEL[r]}
            </StatusChip>
          ))}
        </span>
      </div>

      <Meter
        size="sm"
        value={Math.max(line.availableMilli, 0)}
        max={max}
        mark={line.reorderPointMilli}
        tone={critical ? "danger" : "warn"}
        label={`Kullanılabilir ${formatQty(line.availableMilli, line.unit)}, sipariş noktası ${formatQty(line.reorderPointMilli, line.unit)}`}
      />
      <p className="tabular text-sm text-fg-muted">
        Kullanılabilir {formatQty(line.availableMilli, line.unit)} / sipariş noktası {formatQty(line.reorderPointMilli, line.unit)}
      </p>

      <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-fg-muted">Bekleyen ihtiyaç</dt>
          <dd className="font-semibold">{formatQty(line.waitingNeedMilli, line.unit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Yolda</dt>
          <dd className="font-semibold">{formatQty(line.incomingMilli, line.unit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Önerilen miktar</dt>
          <dd className="font-semibold">{formatQty(line.qtyMilli, line.unit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Birim fiyat</dt>
          <dd className="font-semibold">{priced ? formatMoney(line.unitPriceMinor) : "Fiyat yok"}</dd>
        </div>
        {priced ? (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-fg-muted">Tutar, KDV hariç</dt>
            <dd className="font-semibold">{formatMoney(line.lineNetMinor)}</dd>
          </div>
        ) : null}
      </dl>

      {line.waitingWorkOrders.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          <span>Bekleyen iş emirleri:</span>
          {line.waitingWorkOrders.map((code) => (
            <Link key={code} href={`/uretim/is-emirleri?q=${encodeURIComponent(code)}`} className="tabular font-semibold text-accent underline-offset-4 hover:underline">
              {code}
            </Link>
          ))}
        </p>
      ) : null}
    </li>
  );
}
