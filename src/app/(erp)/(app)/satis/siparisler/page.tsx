import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersScreen } from "@/features/sales/OrdersScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Siparişler" };

export default function Page() {
  return (
    <RequireModule module="sales">
      <Suspense>
        <OrdersScreen />
      </Suspense>
    </RequireModule>
  );
}
