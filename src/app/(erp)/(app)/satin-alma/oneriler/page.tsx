import type { Metadata } from "next";
import { Suspense } from "react";
import { SuggestionsScreen } from "@/features/purchasing/SuggestionsScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Satın alma önerileri" };

export default function Page() {
  return (
    <RequireModule module="purchasing">
      <Suspense>
        <SuggestionsScreen />
      </Suspense>
    </RequireModule>
  );
}
