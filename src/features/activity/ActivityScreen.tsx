"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ACTIVITY_LIMIT, type ActivityRow } from "@/domain/audit-queries";
import { DEPARTMENT_NAMES, type DepartmentCode } from "@/domain/context";
import { can } from "@/domain/permissions";
import { matchesSearch } from "@/domain/text";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { Avatar } from "@/shell/LoginScreen";
import { visibleNav } from "@/shell/nav";
import { useSession } from "@/shell/session";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Field, Input, Select } from "@/ui/Field";
import { formatIstanbulDateTime } from "@/ui/format";
import { ChevronDownIcon, HistoryIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { PickList } from "@/ui/PickList";
import { useActivity, useActivityPeople, useActivityStats } from "./hooks";
import { actionLabel, ENTITY_KINDS, ENTITY_LABEL, entityLabel, isEntityKind } from "./labels";

const DEPARTMENTS = Object.keys(DEPARTMENT_NAMES) as DepartmentCode[];
const DAY_MS = 86_400_000;

function asDepartment(value: string | null): DepartmentCode | undefined {
  return (DEPARTMENTS as string[]).includes(value ?? "") ? (value as DepartmentCode) : undefined;
}

/** "2026-11-15" → o İstanbul gününün başlangıcı. Geçersizse undefined. */
function istanbulDay(value: string | null): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Kayıt hücresi: tür ve kod. Kullanıcı kaydın ekranını görüyorsa çekmeceyi açan bağlantı, görmüyorsa düz metin. */
function RecordCell({ row, canOpen }: { row: ActivityRow; canOpen: boolean }) {
  const label = row.recordLabel ?? "–";
  return (
    <span className="grid min-w-36 max-w-56">
      <span className="text-xs text-fg-muted">{entityLabel(row.entity)}</span>
      {row.recordHref && canOpen ? (
        <Link
          href={row.recordHref}
          className="truncate font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          title={label}
        >
          {label}
        </Link>
      ) : (
        <span className="truncate font-semibold" title={label}>
          {label}
        </span>
      )}
    </span>
  );
}

export function ActivityScreen() {
  const { user } = useSession();
  const [params, setParams] = useUrlState();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [personQuery, setPersonQuery] = useState("");

  const search = params.get("q") ?? "";
  const kindParam = params.get("tur");
  // Kullanıcı kayıtları sorguda da dışlanır; burada yalnızca çip ve adres parametresi gizlenir.
  const seesUsers = user !== null && can(user, "users", "view");
  const kinds = seesUsers ? ENTITY_KINDS : ENTITY_KINDS.filter((k) => k !== "user");
  const entity = isEntityKind(kindParam) && kinds.includes(kindParam) ? kindParam : undefined;
  const departmentCode = asDepartment(params.get("departman"));
  const userId = params.get("kisi") || undefined;
  const fromText = params.get("bas") ?? "";
  const toText = params.get("bit") ?? "";
  const from = istanbulDay(fromText);
  const toDay = istanbulDay(toText);
  const to = toDay ? new Date(toDay.getTime() + DAY_MS) : undefined;

  // Bir fazlası istenir: 500'den fazlası varsa not gösterilir.
  const activity = useActivity({ search, entity, departmentCode, userId, from, to, limit: ACTIVITY_LIMIT + 1 });
  const stats = useActivityStats().data;
  const people = useActivityPeople().data ?? [];
  const person = people.find((p) => p.id === userId);

  const data = activity.data;
  const rows = useMemo(() => (data ?? []).slice(0, ACTIVITY_LIMIT), [data]);
  const truncated = (data?.length ?? 0) > ACTIVITY_LIMIT;
  const filtered = Boolean(search || entity || departmentCode || userId || fromText || toText);
  const clear = () => setParams({ q: null, tur: null, departman: null, kisi: null, bas: null, bit: null });

  const columns = useMemo<Column<ActivityRow>[]>(() => {
    // Kayıt bağlantısı yalnızca kullanıcının görebildiği ekranlara verilir (menü ve Ctrl+K ile aynı kural).
    const screens = new Set(user ? visibleNav(user).map((n) => n.href) : []);
    const canOpen = (href: string | null) => href !== null && screens.has(href.split("?")[0] ?? "");
    return [
      {
        id: "at",
        header: "Zaman",
        cell: (r) => (
          <time dateTime={r.at.toISOString()} className="tabular whitespace-nowrap text-fg-muted">
            {formatIstanbulDateTime(r.at)}
          </time>
        ),
        sortValue: (r) => r.at.getTime(),
        csvValue: (r) => formatIstanbulDateTime(r.at),
      },
      {
        id: "user",
        header: "Kim",
        cell: (r) => (
          <span className="flex min-w-44 items-center gap-2.5">
            <Avatar name={r.userName} department={r.departmentCode} size="sm" />
            <span className="grid min-w-0">
              <span className="truncate font-semibold">{r.userName}</span>
              <span className="truncate text-xs text-fg-muted">{r.departmentName}</span>
            </span>
          </span>
        ),
        sortValue: (r) => r.userName,
        csvValue: (r) => `${r.userName} (${r.departmentName})`,
      },
      {
        id: "record",
        header: "Kayıt",
        cell: (r) => <RecordCell row={r} canOpen={canOpen(r.recordHref)} />,
        sortValue: (r) => `${entityLabel(r.entity)} ${r.recordLabel ?? ""}`,
        csvValue: (r) => `${entityLabel(r.entity)} ${r.recordLabel ?? ""}`.trim(),
      },
      {
        id: "action",
        header: "İşlem",
        cell: (r) => <span className="font-medium whitespace-nowrap">{actionLabel(r.action)}</span>,
        sortValue: (r) => actionLabel(r.action),
      },
      {
        id: "summary",
        header: "Açıklama",
        cell: (r) => <span className="block max-w-xl min-w-64 break-words">{r.summary}</span>,
        sortValue: (r) => r.summary,
      },
    ];
  }, [user]);

  const personItems = people
    .filter((p) => matchesSearch([p.name, p.departmentName, p.title], personQuery))
    .map((p) => ({ id: p.id, primary: p.name, secondary: `${p.title}, ${p.departmentName}${p.active ? "" : " (pasif)"}` }));

  return (
    <Page fill>
      <PageHeader
        title="İşlemler"
        description="Bütün kayıtlarda kim, ne zaman, ne yaptı: siparişler, üretim, stok ve kullanıcılar. Silinen satırlar da burada kalır."
        stats={
          stats && data ? (
            <>
              <HeroStat index={0} label="Bugün" value={<CountUp value={stats.today} format={String} />} hint="Bugün yapılan işlem" />
              <HeroStat index={1} label="Son 7 gün" value={<CountUp value={stats.last7Days} format={String} />} hint="Bugün dahil yedi gün" />
              <HeroStat
                index={2}
                label="En çok işlem yapan"
                value={stats.topDepartment?.name ?? "Henüz yok"}
                hint={stats.topDepartment ? `Bu hafta ${stats.topDepartment.count} işlem` : "Bu hafta işlem yapılmadı"}
              />
              <HeroStat
                index={3}
                label="Listelenen"
                value={<CountUp value={rows.length} format={String} />}
                hint={filtered ? "Süzgeçlere göre" : `En yeni ${ACTIVITY_LIMIT} işleme kadar`}
              />
            </>
          ) : null
        }
      />
      <DataTable
        label="İşlemler"
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={activity.isPending}
        csvFileName="islemler"
        toolbar={<SearchBox label="İşlem ara" value={search} onChange={(q) => setParams({ q })} className="max-w-96 min-w-44 flex-1" />}
        filters={
          <div className="grid w-full min-w-0 gap-3">
            <div role="group" aria-label="Kayıt türü" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
              <FilterChip group="tur" pressed={!entity} onClick={() => setParams({ tur: null })}>
                Tümü
              </FilterChip>
              {kinds.map((k) => (
                <FilterChip key={k} group="tur" pressed={entity === k} onClick={() => setParams({ tur: entity === k ? null : k })}>
                  {ENTITY_LABEL[k]}
                </FilterChip>
              ))}
            </div>
            <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
              <Select label="Departman" wrapperClassName="col-span-2 sm:w-52" value={departmentCode ?? ""} onChange={(e) => setParams({ departman: e.target.value })}>
                <option value="">Tümü</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_NAMES[d]}
                  </option>
                ))}
              </Select>
              <Field label="Kişi" className="col-span-2 sm:w-56">
                {({ id }) => (
                  <button
                    id={id}
                    type="button"
                    aria-label={`Kişi: ${person?.name ?? "Tümü"}`}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setPersonQuery("");
                      setPicked(null);
                      setPicking(true);
                    }}
                    className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-left text-base transition-colors hover:border-line-strong"
                  >
                    <span className={person ? "min-w-0 flex-1 truncate font-semibold" : "min-w-0 flex-1 truncate text-fg-muted"}>{person?.name ?? "Tümü"}</span>
                    <ChevronDownIcon />
                  </button>
                )}
              </Field>
              <Input label="Başlangıç" type="date" wrapperClassName="min-w-0 sm:w-40" value={fromText} onChange={(e) => setParams({ bas: e.target.value })} />
              <Input label="Bitiş" type="date" wrapperClassName="min-w-0 sm:w-40" value={toText} onChange={(e) => setParams({ bit: e.target.value })} />
            </div>
            {filtered || truncated ? (
              <div className="flex flex-wrap items-center gap-2">
                {filtered ? (
                  <Button size="sm" variant="ghost" onClick={clear}>
                    Süzgeçleri temizle
                  </Button>
                ) : null}
                {truncated ? (
                  <span className="text-sm text-fg-muted">En yeni {ACTIVITY_LIMIT} işlem gösteriliyor. Daha eski kayıtlar için tarih aralığını daraltın.</span>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="Bu süzgeçlerle eşleşen işlem yok" action={<Button onClick={clear}>Süzgeçleri temizle</Button>}>
              Yazımı kontrol edin ya da süzgeçleri kaldırın.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz işlem yok" icon={<HistoryIcon size={24} />}>
              Bir kayıt açıldığında ya da değiştiğinde burada görünür.
            </EmptyState>
          )
        }
      />
      <Dialog
        open={picking}
        onOpenChange={setPicking}
        title="Kişi seç"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setParams({ kisi: null });
                setPicking(false);
              }}
            >
              Bütün kişiler
            </Button>
            <Button variant="primary" onClick={() => setPicking(false)}>
              Tamam
            </Button>
          </>
        }
      >
        <PickList
          label="Kişi"
          searchLabel="Kişi ara"
          query={personQuery}
          onQuery={setPersonQuery}
          items={personItems}
          value={picked ?? userId ?? null}
          onChange={(id) => {
            // Adres çubuğu bir sonraki çizimde güncellenir; seçim o ana dek burada tutulur ki radyo hemen işaretlensin.
            setPicked(id);
            setParams({ kisi: id });
          }}
          empty="Bu adla bir çalışan yok"
        />
      </Dialog>
    </Page>
  );
}
