import type { ReactNode } from "react";
import { AppGuard } from "@/shell/AppGuard";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppGuard>{children}</AppGuard>;
}
