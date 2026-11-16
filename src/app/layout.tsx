import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { MotionProvider } from "@/ui/motion";
import { THEME_INIT_SCRIPT } from "@/ui/theme-script";
import { ToastProvider } from "@/ui/Toast";
import "./globals.css";

const body = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700", "800"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "BALTACIOĞLU'S ERP Studio", template: "%s · ERP Studio" },
  description: "Mobilya üretimi için stok, sipariş, üretim ve satın alma yönetimi. Vitrin sürümü, örnek veriyle çalışır.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={`${body.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
