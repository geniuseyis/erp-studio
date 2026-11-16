"use client";

import { DropdownMenu } from "radix-ui";
import { useMemo, useState } from "react";
import { DEPARTMENT_NAMES, type DepartmentCode, LEVEL_NAMES } from "@/domain/context";
import { can } from "@/domain/permissions";
import { matchesSearch } from "@/domain/text";
import type { UserRow } from "@/domain/users";
import { errorMessage } from "@/features/inventory/labels";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { Avatar } from "@/shell/LoginScreen";
import { useSession } from "@/shell/session";
import { useUrlState } from "@/shell/useUrlState";
import { Button, IconButton } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { EditIcon, LockIcon, PlusIcon, UnlockIcon, UsersIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { useSetUserActive, useUsers } from "./hooks";
import { ResetPasswordDialog, UserForm } from "./UserForm";

type Pending = { kind: "edit" | "reset" | "deactivate"; user: UserRow } | { kind: "create" } | null;

const ITEM = "flex cursor-default items-center gap-2.5 rounded-xl px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2";
const DEPARTMENTS = Object.keys(DEPARTMENT_NAMES) as DepartmentCode[];

function asDepartment(value: string | null): DepartmentCode | undefined {
  return (DEPARTMENTS as string[]).includes(value ?? "") ? (value as DepartmentCode) : undefined;
}

export function UsersScreen() {
  const { user: me } = useSession();
  const toast = useToast();
  const users = useUsers();
  const setActive = useSetUserActive();
  const [params, setParams] = useUrlState();
  const [pending, setPending] = useState<Pending>(null);

  const search = params.get("q") ?? "";
  const department = asDepartment(params.get("departman"));
  const canWrite = me ? can(me, "users", "write") : false;
  const all = users.data ?? [];
  const rows = all.filter((u) => (!department || u.departmentCode === department) && matchesSearch([u.name, u.email, u.title], search));

  async function activate(u: UserRow, active: boolean) {
    try {
      await setActive.mutateAsync({ id: u.id, active });
      toast.success(active ? `${u.name} etkinleştirildi` : `${u.name} pasife alındı`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setPending(null);
  }

  const columns = useMemo<Column<UserRow>[]>(() => {
    const list: Column<UserRow>[] = [
      {
        id: "name",
        header: "Ad",
        cell: (u) => (
          <span className="flex min-w-48 items-center gap-3">
            <Avatar name={u.name} department={u.departmentCode} size="sm" />
            <span className="font-semibold">{u.name}</span>
            {u.id === me?.id ? <StatusChip tone="info">Siz</StatusChip> : null}
          </span>
        ),
        sortValue: (u) => u.name,
      },
      { id: "email", header: "E-posta", cell: (u) => <span className="text-fg-muted">{u.email}</span>, sortValue: (u) => u.email },
      { id: "department", header: "Departman", cell: (u) => <span className="whitespace-nowrap">{u.departmentName}</span>, sortValue: (u) => u.departmentName },
      {
        id: "level",
        header: "Düzey",
        cell: (u) => (
          <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-line ring-inset">
            {LEVEL_NAMES[u.level]}
          </span>
        ),
        sortValue: (u) => LEVEL_NAMES[u.level],
      },
      { id: "title", header: "Unvan", cell: (u) => u.title, sortValue: (u) => u.title },
      {
        id: "status",
        header: "Durum",
        cell: (u) => (u.active ? <StatusChip tone="ok">Etkin</StatusChip> : <StatusChip tone="neutral">Pasif</StatusChip>),
        sortValue: (u) => (u.active ? "Etkin" : "Pasif"),
      },
    ];
    if (canWrite) {
      list.push({
        id: "actions",
        header: "İşlemler",
        align: "right",
        cell: (u) => (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label={`İşlemler: ${u.name}`} size="sm">
                <span aria-hidden="true" className="text-lg leading-none">
                  ⋯
                </span>
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-52 rounded-2xl border border-line bg-surface p-1.5 text-sm shadow-panel animate-[pop-in_200ms_var(--ease-spring)]"
              >
                <DropdownMenu.Item className={ITEM} onSelect={() => setPending({ kind: "edit", user: u })}>
                  <EditIcon /> Düzenle
                </DropdownMenu.Item>
                <DropdownMenu.Item className={ITEM} onSelect={() => setPending({ kind: "reset", user: u })}>
                  <LockIcon /> Parolayı sıfırla
                </DropdownMenu.Item>
                {u.active ? (
                  u.id === me?.id ? null : (
                    <DropdownMenu.Item className={`${ITEM} text-danger`} onSelect={() => setPending({ kind: "deactivate", user: u })}>
                      <LockIcon /> Pasife al
                    </DropdownMenu.Item>
                  )
                ) : (
                  <DropdownMenu.Item className={ITEM} onSelect={() => void activate(u, true)}>
                    <UnlockIcon /> Etkinleştir
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ),
      });
    }
    return list;
    // activate yalnızca mutasyonu çağırır; sütunlar kullanıcı ve yetki değişince yeniden kurulur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, canWrite]);

  const active = all.filter((u) => u.active).length;

  return (
    <Page fill>
      <PageHeader
        title="Kullanıcılar"
        description="Çalışanların hesapları, departmanları ve yetki düzeyleri. Yetkiler departman ve düzeyden gelir."
        actions={
          canWrite ? (
            <Button variant="light" icon={<PlusIcon />} onClick={() => setPending({ kind: "create" })}>
              Yeni kullanıcı
            </Button>
          ) : null
        }
        stats={
          users.data ? (
            <>
              <HeroStat index={0} label="Hesap" value={<CountUp value={all.length} format={String} />} hint="Bütün kullanıcılar" />
              <HeroStat index={1} label="Etkin" value={<CountUp value={active} format={String} />} hint="Giriş yapabilir" />
              <HeroStat index={2} label="Pasif" value={<CountUp value={all.length - active} format={String} />} hint="Girişi kapalı" />
              <HeroStat index={3} label="Departman" value={<CountUp value={DEPARTMENTS.length} format={String} />} hint="Kendi modülünde işlem yapar" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Kullanıcılar"
        rows={rows}
        columns={columns}
        rowId={(u) => u.id}
        rowLabel={(u) => u.name}
        loading={users.isPending}
        toolbar={<SearchBox label="Ad, e-posta ya da unvan ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />}
        filters={
          <div role="group" aria-label="Departmanlar" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
            <FilterChip group="departman" pressed={!department} count={all.length} onClick={() => setParams({ departman: null })}>
              Tümü
            </FilterChip>
            {DEPARTMENTS.map((code) => (
              <FilterChip
                key={code}
                group="departman"
                pressed={department === code}
                count={all.filter((u) => u.departmentCode === code).length}
                onClick={() => setParams({ departman: department === code ? null : code })}
              >
                {DEPARTMENT_NAMES[code]}
              </FilterChip>
            ))}
          </div>
        }
        empty={
          <EmptyState
            title="Eşleşen kullanıcı yok"
            icon={<UsersIcon size={24} />}
            action={<Button onClick={() => setParams({ q: null, departman: null })}>Süzgeçleri temizle</Button>}
          />
        }
      />

      {pending?.kind === "create" ? <UserForm onClose={() => setPending(null)} /> : null}
      {pending?.kind === "edit" ? <UserForm user={pending.user} onClose={() => setPending(null)} /> : null}
      {pending?.kind === "reset" ? <ResetPasswordDialog user={pending.user} onClose={() => setPending(null)} /> : null}
      {pending?.kind === "deactivate" ? (
        <Dialog
          open
          onOpenChange={(open) => !open && !setActive.isPending && setPending(null)}
          title={`${pending.user.name} pasife alınsın mı?`}
          description="Kişi bir daha giriş yapamaz; açık oturumu bir sonraki sayfa geçişinde kapanır. Kayıtları silinmez, istediğiniz zaman etkinleştirebilirsiniz."
          footer={
            <>
              <Button variant="ghost" disabled={setActive.isPending} onClick={() => setPending(null)}>
                Vazgeç
              </Button>
              <Button variant="danger" loading={setActive.isPending} onClick={() => void activate(pending.user, false)}>
                Pasife al
              </Button>
            </>
          }
        >
          <p>
            {pending.user.title}, {pending.user.departmentName}
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
