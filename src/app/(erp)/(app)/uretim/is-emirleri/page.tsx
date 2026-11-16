import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkOrdersScreen } from "@/features/production/WorkOrdersScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "İş emirleri" };

export default function Page() {
  return (
    <RequireModule module="planning">
      <Suspense>
        <WorkOrdersScreen />
      </Suspense>
    </RequireModule>
  );
}
