"use client";

import { type ReactNode, useState } from "react";
import { formatMoney, formatQty, type Unit } from "@/domain/units";
import { Button, IconButton } from "@/ui/Button";
import { type Column, DataTable } from "@/ui/DataTable";
import { Dialog } from "@/ui/Dialog";
import { Drawer } from "@/ui/Drawer";
import { EmptyState } from "@/ui/EmptyState";
import { Input, NumberField, Select, Textarea } from "@/ui/Field";
import { MoonIcon, PlusIcon, SunIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useTheme } from "@/ui/theme";
import { useToast } from "@/ui/Toast";

type Row = { code: string; name: string; onHand: number; unit: Unit; shelf: string; cost: number; critical: boolean };

const ROWS: Row[] = [
  { code: "MLZ-0001", name: "MDF Lam 18 mm Parlak Beyaz 2100×2800", onHand: 164_000, unit: "plaka", shelf: "A-01", cost: 159_000, critical: false },
  { code: "MLZ-0008", name: "Meşe Masif 40 mm, Fırınlanmış", onHand: 1_850, unit: "m3", shelf: "B-01", cost: 6_500_000, critical: true },
  { code: "MLZ-0014", name: "ABS Kenar Bandı 22×0,8 mm Beyaz", onHand: 640_000, unit: "m", shelf: "C-02", cost: 650, critical: true },
  { code: "MLZ-0018", name: "Frenli Menteşe 110° Düz, 35 mm Çanak", onHand: 420_000, unit: "adet", shelf: "D-01", cost: 6_200, critical: true },
  { code: "MLZ-0028", name: "Poliüretan Vernik, Mat", onHand: 96_500, unit: "L", shelf: "E-01", cost: 140_000, critical: false },
];

const COLUMNS: Column<Row>[] = [
  { id: "code", header: "Kod", cell: (r) => <span className="tabular font-medium">{r.code}</span>, sortValue: (r) => r.code },
  { id: "onHand", header: "Eldeki", align: "right", cell: (r) => formatQty(r.onHand, r.unit), sortValue: (r) => r.onHand, csvValue: (r) => r.onHand / 1000 },
  {
    id: "name",
    header: "Ad",
    cell: (r) => (
      <span className="flex items-center gap-2">
        {r.name}
        {r.critical ? <StatusChip tone="danger">Kritik</StatusChip> : null}
      </span>
    ),
    sortValue: (r) => r.name,
  },
  { id: "shelf", header: "Raf", cell: (r) => r.shelf, sortValue: (r) => r.shelf },
  { id: "cost", header: "Ortalama maliyet", align: "right", cell: (r) => formatMoney(r.cost), sortValue: (r) => r.cost, csvValue: (r) => r.cost / 100, defaultHidden: true },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  const { resolved, setTheme } = useTheme();
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [qty, setQty] = useState("12,5");

  return (
    <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-10 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Bileşenler</h1>
          <p className="text-fg-muted">Sıcak atölye tasarım sisteminin bütün parçaları ve durumları.</p>
        </div>
        <IconButton
          label={resolved === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
        </IconButton>
      </header>

      <Section title="Düğmeler">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<PlusIcon />}>
            Yeni malzeme
          </Button>
          <Button>Stok girişi</Button>
          <Button variant="ghost">Vazgeç</Button>
          <Button variant="danger">Sayımı iptal et</Button>
          <Button variant="primary" loading>
            Kaydediliyor
          </Button>
          <Button disabled>Yetkiniz yok</Button>
          <Button size="sm">Küçük</Button>
        </div>
      </Section>

      <Section title="Durum çipleri">
        <div className="flex flex-wrap gap-2">
          <StatusChip tone="neutral">Taslak</StatusChip>
          <StatusChip tone="info">Üretimde</StatusChip>
          <StatusChip tone="ok">Onaylandı</StatusChip>
          <StatusChip tone="warn">Malzeme bekliyor</StatusChip>
          <StatusChip tone="danger">Kritik</StatusChip>
        </div>
      </Section>

      <Section title="Stok cetveli">
        <div className="grid max-w-md gap-4">
          <Meter value={164} max={220} mark={60} tone="ok" label="Kullanılabilir 164 plaka, yeniden sipariş noktası 60 plaka" />
          <Meter value={420} max={2400} mark={1000} tone="danger" label="Kullanılabilir 420 adet, yeniden sipariş noktası 1.000 adet" />
          <Meter value={1150} max={2400} mark={1000} tone="warn" label="Kullanılabilir 1.150 adet, yeniden sipariş noktası 1.000 adet" />
        </div>
      </Section>

      <Section title="Form alanları">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Input label="Malzeme adı" defaultValue="MDF Lam 18 mm Parlak Beyaz" />
          <Select label="Kategori" defaultValue="panel">
            <option value="panel">Panel</option>
            <option value="masif">Masif</option>
          </Select>
          <NumberField label="Miktar" suffix="plaka" value={qty} onChange={(e) => setQty(e.target.value)} hint="Virgül ya da nokta kullanabilirsiniz." />
          <NumberField label="Birim maliyet" suffix="TL" defaultValue="abc" error="Geçerli bir tutar girin" />
          <Input label="Raf" defaultValue="A-01" disabled />
          <Textarea label="Not" placeholder="İrsaliye numarası, teslim eden…" />
        </div>
      </Section>

      <Section title="Pencere, çekmece ve bildirim">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog(true)}>Pencereyi aç</Button>
          <Button onClick={() => setDrawer(true)}>Çekmeceyi aç</Button>
          <Button onClick={() => toast.success("120 adet giriş kaydedildi")}>Başarı bildirimi</Button>
          <Button onClick={() => toast.error("Kullanılabilir stok yetersiz")}>Hata bildirimi</Button>
        </div>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Stok girişi"
          description="MLZ-0018 · Frenli Menteşe 110° Düz"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>
                Vazgeç
              </Button>
              <Button variant="primary" onClick={() => setDialog(false)}>
                Girişi kaydet
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <NumberField label="Miktar" suffix="adet" defaultValue="120" />
            <NumberField label="Birim maliyet" suffix="TL" defaultValue="62,00" />
            <Textarea label="Not" />
          </div>
        </Dialog>
        <Drawer
          open={drawer}
          onOpenChange={setDrawer}
          title="MDF Lam 18 mm"
          subtitle={
            <>
              <span className="tabular">MLZ-0001</span>
              <StatusChip tone="ok">Yeterli</StatusChip>
            </>
          }
          footer={<Button variant="primary">Stok girişi</Button>}
        >
          <p className="text-fg-muted">Ayrıntı paneli listeyi kapatmadan sağdan açılır.</p>
        </Drawer>
      </Section>

      <Section title="Tablo">
        <div className="h-80">
          <DataTable
            label="Örnek malzemeler"
            rows={ROWS}
            columns={COLUMNS}
            rowId={(r) => r.code}
            rowLabel={(r) => r.code}
            selectable
            csvFileName="ornek-malzemeler"
            onRowClick={() => setDrawer(true)}
            bulkActions={() => <Button size="sm">Sayım aç</Button>}
            empty={<EmptyState title="Malzeme yok" />}
          />
        </div>
      </Section>

      <Section title="Boş durum ve yükleniyor">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-line bg-surface">
            <EmptyState title="Aramanızla eşleşen malzeme yok" action={<Button>Süzgeçleri temizle</Button>}>
              Yazımı kontrol edin ya da süzgeçleri kaldırın.
            </EmptyState>
          </div>
          <div className="grid content-start gap-3 rounded-md border border-line bg-surface p-5">
            <Skeleton className="w-1/2" />
            <Skeleton />
            <Skeleton className="w-4/5" />
          </div>
        </div>
      </Section>
    </main>
  );
}
