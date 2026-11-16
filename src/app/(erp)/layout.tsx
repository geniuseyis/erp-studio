import type { ReactNode } from "react";
import { AppProviders } from "@/shell/providers";

/** Veritabanına ihtiyaç duyan bütün ekranlar (giriş ve uygulama) bu düzenin altındadır. */
export default function ErpLayout({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
