import type { BootStep } from "@/db/client";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { CheckIcon } from "@/ui/icons";
import { BrandMark } from "./Brand";

const STEPS: { step: BootStep; label: string }[] = [
  { step: "engine", label: "Veritabanı başlatılıyor" },
  { step: "schema", label: "Tablolar kuruluyor" },
  { step: "seed", label: "Örnek veri yükleniyor" },
];

/** 41 çentikli cetvel: her beşincisi uzun. Açılışta soldan sağa çizilir. */
const TICKS = Array.from({ length: 41 }, (_, i) => i);

/** Tarayıcıdaki veritabanı hazırlanırken gösterilir. `step` null ise açılış başarısız olmuştur. */
export function BootScreen({ step, onRetry }: { step: BootStep | null; onRetry: () => void }) {
  const current = STEPS.findIndex((s) => s.step === step);
  const progress = step === null ? 0 : (current + 1) / STEPS.length;
  return (
    <main className="walnut grid min-h-dvh place-items-center px-6">
      <div className="grid w-full max-w-md gap-10">
        <div className="grid justify-items-center gap-5 text-center">
          <BrandMark className="size-16 rounded-[20px] text-3xl animate-[pop-in_600ms_var(--ease-pop)_both]" />
          <div className="grid gap-1 animate-[rise-in_600ms_var(--ease-spring)_both] [animation-delay:120ms]">
            <p className="font-display text-2xl font-bold tracking-tight">BALTACIOĞLU&apos;S</p>
            <p className="text-hero-fg-muted">ERP Studio</p>
          </div>
        </div>

        {step === null ? (
          <div role="alert" className="glass grid justify-items-start gap-3 rounded-[22px] p-5">
            <p className="font-display text-lg font-semibold">Veritabanı açılamadı</p>
            <p className="text-hero-fg-muted">
              Tarayıcınız bu sayfanın veri saklamasına izin vermiyor olabilir. Gizli pencereyi kapatıp yeniden deneyin.
            </p>
            <Button variant="light" onClick={onRetry}>
              Yeniden dene
            </Button>
          </div>
        ) : (
          <div className="grid gap-6">
            {/* Cetvel: çentikler sırayla çizilir, altındaki bal rengi şerit ilerlemeyi gösterir. */}
            <div aria-hidden="true" className="grid gap-1.5">
              <div className="flex h-5 items-end justify-between">
                {TICKS.map((i) => (
                  <span
                    key={i}
                    className={cn("w-px origin-bottom bg-hero-fg-muted/70 animate-[tick-in_400ms_var(--ease-spring)_both]", i % 5 === 0 ? "h-5" : "h-2.5")}
                    style={{ animationDelay: `${i * 18}ms` }}
                  />
                ))}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#f3cf8e,#d99a45)] shadow-[0_0_16px_rgb(243_207_142/0.6)] transition-[width] duration-700 ease-[var(--ease-spring)]"
                  style={{ width: `${Math.max(progress * 100, 8)}%` }}
                />
              </div>
            </div>
            <ol aria-live="polite" className="grid gap-3">
              {STEPS.map((s, i) => {
                const done = i < current;
                const active = i === current;
                return (
                  <li key={s.step} className={cn("flex items-center gap-3 transition-opacity", !done && !active && "opacity-50")}>
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                        done ? "border-transparent bg-[#f3cf8e] text-[#22170f]" : "border-hero-fg-muted/60",
                        active && "border-[#f3cf8e] shadow-[0_0_0_4px_rgb(243_207_142/0.18)]",
                      )}
                    >
                      {done ? <CheckIcon size={13} /> : active ? <span className="size-2 animate-pulse rounded-full bg-[#f3cf8e]" /> : null}
                    </span>
                    <span className={cn(active && "font-semibold")}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <p className="text-center text-sm text-hero-fg-muted">
          Bu vitrin sürümü gerçek bir PostgreSQL veritabanını tarayıcınızın içinde çalıştırır. Verileriniz bu cihazdan çıkmaz.
        </p>
      </div>
      <span className="walnut-ruler" aria-hidden="true" />
    </main>
  );
}
