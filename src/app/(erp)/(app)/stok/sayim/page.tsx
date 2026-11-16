import type { Metadata } from "next";
import { Suspense } from "react";
import { CountsScreen } from "@/features/inventory/CountsScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Sayım" };

export default function Page() {
  return (
    <RequireModule module="inventory">
      <Suspense>
        <CountsScreen />
      </Suspense>
    </RequireModule>
  );
}
