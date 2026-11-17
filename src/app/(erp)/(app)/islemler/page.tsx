import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityScreen } from "@/features/activity/ActivityScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "İşlemler" };

export default function Page() {
  return (
    <RequireModule module="reports">
      <Suspense>
        <ActivityScreen />
      </Suspense>
    </RequireModule>
  );
}
