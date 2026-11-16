"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { DEPARTMENT_NAMES, type DepartmentCode } from "@/domain/context";
import { isDomainError } from "@/domain/errors";
import { listUsers, type UserRow } from "@/domain/users";
import { DEMO_PASSWORD, demoEmail, SEED_USERS } from "@/seed/data/users";
import { Button, Spinner } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Dialog } from "@/ui/Dialog";
import { Field, Input } from "@/ui/Field";
import { AlertIcon, EyeIcon, EyeOffIcon, UsersIcon } from "@/ui/icons";
import { useToast } from "@/ui/Toast";
import { BrandMark } from "./Brand";
import { useDb } from "./db-context";
import { safeNextPath } from "./nav";
import { useSession } from "./session";

const DEMO_EMAILS = new Set(SEED_USERS.map((u) => demoEmail(u.name)));
/** Departman içinde sıra: müdür, uzman, operatör. */
const LEVEL_ORDER = { mudur: 0, uzman: 1, operator: 2 } as const;
const REBUILT_NOTICE_KEY = "erp.rebuiltNotice";

/** Her departmanın baş harf rozeti kendi ağaç ya da malzeme tonunda. */
export const DEPARTMENT_TINT: Record<DepartmentCode, string> = {
  yonetim: "linear-gradient(140deg,#f3cf8e,#a8641f)",
  satis: "linear-gradient(140deg,#f0b48f,#b4562c)",
  planlama: "linear-gradient(140deg,#d9d29a,#7f7a35)",
  atolye: "linear-gradient(140deg,#d8b38a,#7a4a22)",
  depo: "linear-gradient(140deg,#c9b8a3,#6a5643)",
  satinalma: "linear-gradient(140deg,#a9c9c0,#3f7467)",
  bt: "linear-gradient(140deg,#b5c3d9,#4a6286)",
};

/** Giriş: ceviz zemin üzerinde tek kart. Demo hesapları ayrı bir pencerede açılır. */
export function LoginScreen() {
  const { db, persistent, rebuilt } = useDb();
  const { status, signIn } = useSession();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("sonra"));
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  const demo = useQuery({ queryKey: ["users", "demo"], queryFn: () => listUsers(db) });
  const accounts = (demo.data ?? [])
    .filter((u) => u.active && DEMO_EMAILS.has(u.email))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  useEffect(() => {
    if (status === "in") router.replace(next);
  }, [status, next, router]);

  useEffect(() => {
    if (!rebuilt) return;
    try {
      if (sessionStorage.getItem(REBUILT_NOTICE_KEY)) return;
      sessionStorage.setItem(REBUILT_NOTICE_KEY, "1");
    } catch {
      // Depolama kapalıysa bildirim her girişte bir kez gösterilir.
    }
    toast.success("Yeni sürüm yüklendi, örnek veri yenilendi");
  }, [rebuilt, toast]);

  async function attempt(who: string, mail: string, pass: string) {
    setBusy(who);
    setFailed(false);
    try {
      await signIn(mail, pass);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setFailed(true);
      setBusy(null);
      setDemoOpen(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!email.trim() || !password) return;
    void attempt("form", email, password);
  }

  return (
    <main className="walnut grid min-h-dvh place-items-center px-4 py-10">
      <div className="grid w-full max-w-[25rem] gap-6 animate-[rise-in_520ms_var(--ease-spring)_both]">
        <div className="flex items-center justify-center gap-3">
          <BrandMark className="size-11 rounded-[14px] text-xl" />
          <div className="grid gap-0.5">
            <span className="font-display text-lg leading-none font-bold tracking-tight">BALTACIOĞLU&apos;S</span>
            <span className="text-sm leading-none text-hero-fg-muted">ERP Studio</span>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="grid gap-5 rounded-[26px] bg-surface p-7 text-fg shadow-panel sm:p-8">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold">Giriş yapın</h1>
            <p className="text-fg-muted">Hesabınızın e-posta adresi ve parolasıyla.</p>
          </div>

          {failed ? (
            <p role="alert" className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-sm font-semibold text-danger animate-[pop-in_300ms_var(--ease-pop)]">
              <AlertIcon />
              E-posta ya da parola hatalı.
            </p>
          ) : null}

          <Input
            label="E-posta"
            type="email"
            autoComplete="username"
            placeholder="ad.soyad@sirket.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={submitted && !email.trim() ? "E-posta girin" : null}
          />
          <Field label="Parola" error={submitted && !password ? "Parola girin" : null}>
            {(a) => (
              <div className="relative">
                <input
                  {...a}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-surface pr-12 pl-3 text-base text-fg shadow-[inset_0_1px_2px_rgb(60_38_18/0.05)] transition-[border-color] hover:border-line-strong focus:border-accent aria-[invalid=true]:border-danger"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Parolayı gizle" : "Parolayı göster"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              </div>
            )}
          </Field>

          <Button type="submit" variant="primary" size="lg" loading={busy === "form"} disabled={busy !== null}>
            Giriş yap
          </Button>

          <div className="flex items-center gap-3 text-sm text-fg-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            ya da
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button size="lg" icon={<UsersIcon size={18} />} disabled={busy !== null || demo.isPending} onClick={() => setDemoOpen(true)}>
            Demo hesabıyla giriş yap
          </Button>
        </form>

        <div className="grid gap-1 text-center text-sm text-hero-fg-muted">
          <p>Vitrin sürümü: veriler yalnızca bu tarayıcıda durur.</p>
          {!persistent ? <p className="font-semibold text-hero-fg">Veriler bu sekme kapanınca silinir.</p> : null}
        </div>
      </div>

      <Dialog
        open={demoOpen}
        onOpenChange={(open) => busy === null && setDemoOpen(open)}
        size="md"
        title="Demo hesapları"
        description={`Bir çalışan seçin, onun yetkileriyle girin. Bütün demo hesaplarının parolası: ${DEMO_PASSWORD}`}
      >
        <div className="grid gap-4 pb-3">
          {(Object.keys(DEPARTMENT_NAMES) as DepartmentCode[]).map((code) => {
            const people = accounts.filter((u) => u.departmentCode === code);
            if (people.length === 0) return null;
            return (
              <section key={code} className="grid gap-1">
                <h3 className="px-2 text-xs font-semibold text-fg-muted">{DEPARTMENT_NAMES[code]}</h3>
                <ul className="grid gap-0.5 sm:grid-cols-2">
                  {people.map((u) => (
                    <li key={u.id}>
                      <DemoAccount user={u} busy={busy} onPick={() => void attempt(u.id, u.email, DEMO_PASSWORD)} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Dialog>
    </main>
  );
}

function DemoAccount({ user: u, busy, onPick }: { user: UserRow; busy: string | null; onPick: () => void }) {
  return (
    <button
      type="button"
      disabled={busy !== null}
      onClick={onPick}
      className={cn("press flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2 disabled:opacity-60")}
    >
      <Avatar name={u.name} department={u.departmentCode} size="sm" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-semibold">{u.name}</span>
        <span className="truncate text-xs text-fg-muted">{u.title}</span>
      </span>
      {busy === u.id ? <Spinner /> : null}
    </button>
  );
}

/** Baş harfli yuvarlak rozet, departmanın renginde. */
export function Avatar({ name, department, size = "md" }: { name: string; department: DepartmentCode; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold text-[#22170f] shadow-[inset_0_1px_0_rgb(255_255_255/0.45)]",
        size === "sm" ? "size-8 text-[0.6875rem]" : "size-10 text-sm",
      )}
      style={{ background: DEPARTMENT_TINT[department] }}
    >
      {initials(name)}
    </span>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");
}
