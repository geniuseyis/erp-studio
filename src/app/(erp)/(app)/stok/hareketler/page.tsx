import type { Metadata } from "next";
import { Suspense } from "react";
import { MovementsScreen } from "@/features/inventory/MovementsScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Stok hareketleri" };

export default function Page() {
  return (
    <RequireModule module="inventory">
      <Suspense>
        <MovementsScreen />
      </Suspense>
    </RequireModule>
  );
}
