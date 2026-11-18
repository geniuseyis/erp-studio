import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanScreen } from "@/features/planning/PlanScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Haftalık plan" };

export default function Page() {
  return (
    <RequireModule module="planning">
      <Suspense>
        <PlanScreen />
      </Suspense>
    </RequireModule>
  );
}
