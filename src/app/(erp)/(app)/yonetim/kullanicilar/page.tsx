import type { Metadata } from "next";
import { Suspense } from "react";
import { UsersScreen } from "@/features/users/UsersScreen";
import { RequireModule } from "@/shell/AppGuard";

export const metadata: Metadata = { title: "Kullanıcılar" };

export default function Page() {
  return (
    <RequireModule module="users">
      <Suspense>
        <UsersScreen />
      </Suspense>
    </RequireModule>
  );
}
