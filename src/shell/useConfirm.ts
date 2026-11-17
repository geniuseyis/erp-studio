"use client";

import { createElement, type MouseEvent, type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog, type ConfirmDialogProps } from "@/ui/ConfirmDialog";

export type ConfirmOptions = Pick<ConfirmDialogProps, "title" | "body" | "confirmLabel" | "tone" | "large"> & {
  /**
   * Onaylanınca çalışan iş. Bitene dek pencere açık kalır, onay düğmesi kilitlidir; sonra pencere kapanır.
   * `false` dönerse (iş yapılmadı ya da hata verdi) `confirm` da false ile çözülür.
   */
  action?: () => Promise<boolean | void>;
};

type Request = { options: ConfirmOptions; resolve: (ok: boolean) => void };

/**
 * Değişiklik yapan işlemden önce onay sorar. `confirm(...)` pencereyi açar; vazgeçilirse false, onaylanıp iş
 * bittiğinde true ile çözülür. `element` bileşenin çıktısına bir kez konur.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; element: ReactElement | null; isOpen: boolean } {
  const [request, setRequest] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  // Açık istek, sahibi kaldırılınca (çekmece kapandı, sayfa değişti) vazgeçilmiş sayılsın diye: bekleyen söz asılı kalmaz.
  const pending = useRef<Request | null>(null);
  useEffect(() => {
    pending.current = request;
  }, [request]);
  useEffect(() => {
    const current = pending;
    return () => current.current?.resolve(false);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest((previous) => {
          previous?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      request?.resolve(ok);
      // Bu arada açılmış daha yeni bir istek düşürülmez.
      setRequest((current) => (current === request ? null : current));
    },
    [request],
  );

  const onConfirm = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      // Çift tıklamanın ikinci tıklaması (açan düğmeden taşan dokunuş dahil) onaylamaz; iş sürerken düğme kilitlidir
      // ve iş kendi çift tıklama korumasıyla (useGuardedRun) çalışır.
      if (!request || busy || event.detail > 1) return;
      const { action } = request.options;
      if (!action) return close(true);
      setBusy(true);
      let ok = false;
      try {
        ok = (await action()) !== false;
      } finally {
        setBusy(false);
        close(ok);
      }
    },
    [request, close, busy],
  );

  const onCancel = useCallback(() => {
    if (!busy) close(false);
  }, [close, busy]);

  const element = request ? createElement(ConfirmDialog, { ...request.options, busy, onConfirm: (e) => void onConfirm(e), onCancel }) : null;

  return { confirm, element, isOpen: request !== null };
}
