import type { Metadata } from "next";
import { Suspense } from "react";
import { SuppliersScreen } from "@/features/purchasing/SuppliersScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Tedarikçiler" };

export default function Page() {
  return (
    <RequireModule module="purchasing">
      <Suspense>
        <SuppliersScreen />
      </Suspense>
    </RequireModule>
  );
}
