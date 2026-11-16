"use client";

import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from "react";
import { cn } from "./cn";

const CONTROL =
  "w-full rounded-xl border border-line bg-surface px-3 text-base text-fg shadow-[inset_0_1px_2px_rgb(60_38_18/0.05)] placeholder:text-fg-muted/80 " +
  "transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--honey)_22%,transparent)] " +
  "disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-danger";

type FieldProps = {
  label: string;
  /** Alanın altında gösterilen kısa açıklama. */
  hint?: string;
  /** Doluysa alan hatalı işaretlenir ve ileti ekran okuyucuya duyurulur. */
  error?: string | null;
  className?: string;
  children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean | undefined }) => ReactNode;
};

/** Etiket, açıklama ve hata iletisini denetime bağlar. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; hint?: string; error?: string | null; wrapperClassName?: string };

export function Input({ label, hint, error, wrapperClassName, className, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(a) => <input {...a} className={cn(CONTROL, "h-10", className)} {...rest} />}
    </Field>
  );
}

/** Ondalık sayı girişi. Virgül ve nokta kabul eder; değeri metin olarak verir, çeviriyi çağıran yapar. */
export function NumberField({
  label,
  hint,
  error,
  wrapperClassName,
  className,
  suffix,
  ...rest
}: Common & { suffix?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(a) => (
        <div className="relative">
          <input
            {...a}
            inputMode="decimal"
            autoComplete="off"
            className={cn(CONTROL, "tabular h-10 text-right", suffix && "pr-14", className)}
            {...rest}
          />
          {suffix ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-muted">{suffix}</span>
          ) : null}
        </div>
      )}
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  wrapperClassName,
  className,
  children,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(a) => (
        <select {...a} className={cn(CONTROL, "h-10 pr-8", className)} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Textarea({ label, hint, error, wrapperClassName, className, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(a) => <textarea {...a} rows={3} className={cn(CONTROL, "py-2", className)} {...rest} />}
    </Field>
  );
}
