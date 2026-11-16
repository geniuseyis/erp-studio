import type { Metadata } from "next";
import { Suspense } from "react";
import { MaterialsScreen } from "@/features/inventory/MaterialsScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Malzemeler" };

export default function Page() {
  return (
    <RequireModule module="inventory">
      <Suspense>
        <MaterialsScreen />
      </Suspense>
    </RequireModule>
  );
}
