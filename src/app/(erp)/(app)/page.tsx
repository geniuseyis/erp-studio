import type { Metadata } from "next";
import { DashboardScreen } from "@/features/dashboard/DashboardScreen";

export const metadata: Metadata = { title: "Ana panel" };

export default function Page() {
  return <DashboardScreen />;
}
