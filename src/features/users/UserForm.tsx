"use client";

import { type FormEvent, useRef, useState } from "react";
import { DEPARTMENT_NAMES, type DepartmentCode, LEVEL_NAMES, type Level } from "@/domain/context";
import { isDomainError } from "@/domain/errors";
import { MIN_PASSWORD_LENGTH, type UserRow } from "@/domain/users";
import { errorMessage } from "@/features/inventory/labels";
import { useSession } from "@/shell/session";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input, Select } from "@/ui/Field";
import { useToast } from "@/ui/Toast";
import { useCreateUser, useResetPassword, useUpdateUser } from "./hooks";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type FieldName = "name" | "email" | "password";

/** Yeni kullanıcı ya da düzenleme. E-posta ve parola yalnızca eklerken girilir; parola ayrıca sıfırlanır. */
export function UserForm({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const editing = user !== undefined;
  const { user: me } = useSession();
  // Kişi kendi departmanını ve düzeyini değiştiremez (servis de reddeder); alanlar kilitli gösterilir.
  const ownAccount = editing && user.id === me?.id;
  const toast = useToast();
  const create = useCreateUser();
  const update = useUpdateUser();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState<DepartmentCode>(user?.departmentCode ?? "satis");
  const [level, setLevel] = useState<Level>(user?.level ?? "uzman");
  const [title, setTitle] = useState(user?.title ?? "");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Ad soyad girin";
    if (!editing && !EMAIL.test(email.trim())) next.email = "Geçerli bir e-posta girin";
    if (!editing && password.length < MIN_PASSWORD_LENGTH) next.password = `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı`;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    submitting.current = true;
    setBusy(true);
    try {
      if (editing) {
        await update.mutateAsync({ id: user.id, patch: { name, departmentCode: department, level, title } });
        toast.success(`${name.trim()} güncellendi`);
      } else {
        await create.mutateAsync({ name, email, password, departmentCode: department, level, title });
        toast.success(`${name.trim()} eklendi`);
      }
      onClose();
    } catch (error) {
      if (isDomainError(error) && error.code === "DUPLICATE") setErrors({ email: error.message });
      else toast.error(errorMessage(error));
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && !busy && onClose()}
      title={editing ? "Kullanıcıyı düzenle" : "Yeni kullanıcı"}
      description={editing ? user.email : "Hesap açılınca kişi bu e-posta ve parolayla girer. Yetkiler departman ve düzeye göre belirlenir."}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="user-form" loading={busy}>
            {editing ? "Değişiklikleri kaydet" : "Kullanıcıyı ekle"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Ad soyad" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} wrapperClassName="sm:col-span-2" />
        {editing ? null : (
          <>
            <Input label="E-posta" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
            <Input
              label="Parola"
              type="password"
              autoComplete="new-password"
              hint={`En az ${MIN_PASSWORD_LENGTH} karakter`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />
          </>
        )}
        <Select
          label="Departman"
          value={department}
          disabled={ownAccount}
          hint={ownAccount ? "Kendi departmanınızı başka bir yetkili değiştirir" : undefined}
          onChange={(e) => setDepartment(e.target.value as DepartmentCode)}
        >
          {(Object.keys(DEPARTMENT_NAMES) as DepartmentCode[]).map((code) => (
            <option key={code} value={code}>
              {DEPARTMENT_NAMES[code]}
            </option>
          ))}
        </Select>
        <Select
          label="Düzey"
          value={level}
          disabled={ownAccount}
          onChange={(e) => setLevel(e.target.value as Level)}
          hint={ownAccount ? "Kendi düzeyinizi başka bir yetkili değiştirir" : "Müdür onaylar, uzman kayıt açar, operatör yürütür"}
        >
          {(Object.keys(LEVEL_NAMES) as Level[]).map((l) => (
            <option key={l} value={l}>
              {LEVEL_NAMES[l]}
            </option>
          ))}
        </Select>
        <Input label="Unvan" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ör. Satış Uzmanı" wrapperClassName="sm:col-span-2" />
      </form>
    </Dialog>
  );
}

/** Yöneticinin bir kullanıcıya yeni parola vermesi. */
export function ResetPasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const toast = useToast();
  const reset = useResetPassword();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (reset.isPending) return;
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı`);
    try {
      await reset.mutateAsync({ id: user.id, password });
      toast.success(`${user.name} parolası sıfırlandı`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !reset.isPending && onClose()}
      title={`${user.name} için yeni parola`}
      description="Eski parola hemen geçersiz olur. Yeni parolayı kişiye güvenli bir yoldan iletin."
      footer={
        <>
          <Button variant="ghost" disabled={reset.isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="reset-form" loading={reset.isPending}>
            Parolayı sıfırla
          </Button>
        </>
      }
    >
      <form id="reset-form" onSubmit={onSubmit} noValidate>
        <Input
          label="Yeni parola"
          type="password"
          autoComplete="new-password"
          hint={`En az ${MIN_PASSWORD_LENGTH} karakter`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
      </form>
    </Dialog>
  );
}
