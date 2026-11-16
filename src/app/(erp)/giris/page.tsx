import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/shell/LoginScreen";

export const metadata: Metadata = { title: "Giriş" };

export default function Page() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
