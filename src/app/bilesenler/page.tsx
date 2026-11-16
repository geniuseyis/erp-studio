import { notFound } from "next/navigation";
import { Gallery } from "./Gallery";

/** Bileşen galerisi: yalnızca tarayıcı testleri ve görsel kontrol içindir; yayında bulunmaz. */
export default function Page() {
  if (process.env.NEXT_PUBLIC_E2E !== "1") notFound();
  return <Gallery />;
}
