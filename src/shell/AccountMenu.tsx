"use client";

import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { DEPARTMENT_NAMES, type SessionUser } from "@/domain/context";
import { ChevronDownIcon, LogoutIcon, SettingsIcon, UsersIcon } from "@/ui/icons";
import { initials } from "./LoginScreen";
import { useSession } from "./session";

const ITEM = "flex cursor-default items-center gap-2.5 rounded-xl px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2";

export function AccountMenu({ user }: { user: SessionUser }) {
  const { signOut } = useSession();
  const router = useRouter();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Hesap menüsü: ${user.name}, ${user.title}`}
        className="press flex h-11 items-center gap-2.5 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-left shadow-[0_1px_2px_rgb(60_38_18/0.06)] hover:border-line-strong"
      >
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#f3cf8e,#a8641f)] text-xs font-bold text-[#2a1a0e]">
          {initials(user.name)}
        </span>
        <span className="hidden min-w-0 sm:grid">
          <span className="truncate text-sm leading-tight font-medium">{user.name}</span>
          <span className="truncate text-xs leading-tight text-fg-muted">{user.title}</span>
        </span>
        <ChevronDownIcon size={14} className="text-fg-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-72 rounded-2xl border border-line bg-surface p-1.5 text-sm shadow-panel animate-[pop-in_200ms_var(--ease-spring)]">
          <div className="mb-1 grid gap-0.5 rounded-xl bg-surface-2 px-3 py-2.5">
            <span className="font-display text-base font-semibold">{user.name}</span>
            <span className="text-fg-muted">
              {user.title}, {DEPARTMENT_NAMES[user.departmentCode]}
            </span>
            <span className="truncate text-xs text-fg-muted">{user.email}</span>
          </div>
          <div className="pt-1">
            <DropdownMenu.Item className={ITEM} onSelect={() => router.push("/ayarlar")}>
              <SettingsIcon /> Ayarlar
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM} onSelect={signOut}>
              <UsersIcon /> Hesap değiştir
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM} onSelect={signOut}>
              <LogoutIcon /> Çıkış yap
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
