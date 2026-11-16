"use client";

import { useState } from "react";
import { announceChange, useDb } from "@/shell/db-context";
import { Page, PageHeader } from "@/shell/AppGuard";
import { endSession } from "@/shell/session";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { useToast } from "@/ui/Toast";

export function SettingsScreen() {
  const handle = useDb();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      await handle.reset();
      toast.success("Veri sıfırlandı, örnek veri yeniden yüklendi");
      announceChange();
      endSession();
    } catch (e) {
      console.error(e);
      toast.error("Veri sıfırlanamadı. Sayfayı yenileyip yeniden deneyin.");
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Page>
      <PageHeader title="Ayarlar" description="Vitrin verisini ve bu tarayıcıdaki çalışma ortamını yönetin." />
      <section className="grid max-w-2xl gap-3 rounded-[22px] border border-line bg-surface p-6 shadow-card">
        <h2 className="text-lg font-semibold">Örnek veri</h2>
        <p className="text-fg-muted">
          Bu vitrin sürümünde bütün kayıtlar tarayıcınızdaki veritabanında durur. Sıfırlarsanız yaptığınız bütün değişiklikler silinir ve
          başlangıçtaki örnek veri yeniden yüklenir. {handle.persistent ? null : "Tarayıcı deposu kapalı olduğu için veriler bu sekme kapanınca zaten silinir."}
        </p>
        <div>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Veriyi sıfırla
          </Button>
        </div>
      </section>

      <Dialog
        open={confirm}
        onOpenChange={(open) => !busy && setConfirm(open)}
        title="Veri sıfırlansın mı?"
        description="Yaptığınız bütün değişiklikler silinir. Bu işlem geri alınamaz."
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
              Vazgeç
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void reset()}>
              Veriyi sıfırla
            </Button>
          </>
        }
      >
        <p>Sıfırlamadan sonra giriş ekranına dönersiniz.</p>
      </Dialog>
    </Page>
  );
}
