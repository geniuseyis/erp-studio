"use client";

import { announceChange, useDb } from "@/shell/db-context";
import { Page, PageHeader } from "@/shell/AppGuard";
import { endSession } from "@/shell/session";
import { useConfirm } from "@/shell/useConfirm";
import { Button } from "@/ui/Button";
import { useToast } from "@/ui/Toast";

export function SettingsScreen() {
  const handle = useDb();
  const toast = useToast();
  const ask = useConfirm();

  async function reset(): Promise<boolean> {
    try {
      await handle.reset();
      toast.success("Veri sıfırlandı, örnek veri yeniden yüklendi");
      // Oturum hemen kapanır; yenilemenin bitmesi beklenmez.
      void announceChange();
      endSession();
      return true;
    } catch (e) {
      console.error(e);
      toast.error("Veri sıfırlanamadı. Sayfayı yenileyip yeniden deneyin.");
      return false;
    }
  }

  function onReset() {
    void ask.confirm({
      title: "Veri sıfırlansın mı?",
      body: (
        <>
          <p>Yaptığınız bütün değişiklikler silinecek ve başlangıçtaki örnek veri yeniden yüklenecek. Geri alınamaz.</p>
          <p className="text-fg-muted">Oturum kapanır; sıfırlamadan sonra giriş ekranına dönersiniz.</p>
        </>
      ),
      confirmLabel: "Veriyi sıfırla",
      tone: "danger",
      action: reset,
    });
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
          <Button variant="danger" onClick={onReset}>
            Veriyi sıfırla
          </Button>
        </div>
      </section>
      {ask.element}
    </Page>
  );
}
