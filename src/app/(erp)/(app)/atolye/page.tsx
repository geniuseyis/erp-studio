import type { Metadata } from "next";
import { Suspense } from "react";
import { ShopfloorScreen } from "@/features/production/ShopfloorScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Atölye" };

export default function Page() {
  return (
    <RequireModule module="shopfloor">
      <Suspense>
        <ShopfloorScreen />
      </Suspense>
    </RequireModule>
  );
}
