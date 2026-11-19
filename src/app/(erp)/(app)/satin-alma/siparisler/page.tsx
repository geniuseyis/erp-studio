import type { Metadata } from "next";
import { Suspense } from "react";
import { PurchaseOrdersScreen } from "@/features/purchasing/PurchaseOrdersScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Satın alma siparişleri" };

export default function Page() {
  return (
    <RequireModule module="purchasing">
      <Suspense>
        <PurchaseOrdersScreen />
      </Suspense>
    </RequireModule>
  );
}
