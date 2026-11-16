import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsScreen } from "@/features/production/ProductsScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Ürünler" };

export default function Page() {
  return (
    <RequireModule module="planning">
      <Suspense>
        <ProductsScreen />
      </Suspense>
    </RequireModule>
  );
}
