import type { Metadata } from "next";
import { Suspense } from "react";
import { ReceivingScreen } from "@/features/inventory/ReceivingScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Mal kabul" };

export default function Page() {
  return (
    <RequireModule module="inventory">
      <Suspense>
        <ReceivingScreen />
      </Suspense>
    </RequireModule>
  );
}