import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomersScreen } from "@/features/sales/CustomersScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Müşteriler" };

export default function Page() {
  return (
    <RequireModule module="sales">
      <Suspense>
        <CustomersScreen />
      </Suspense>
    </RequireModule>
  );
}
