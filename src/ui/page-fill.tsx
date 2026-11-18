"use client";

import { createContext } from "react";

/** `Page fill` içindeki ekranı tanıtır; bant ve tablo kişisel ayarlarını bu anahtarla saklar. */
export const PageFillContext = createContext<{ screen: string } | null>(null);

/** Özet bandı daraltılmışken HeroStat yalnızca ilk kutuyu, tek satırlık biçimde çizer. */
export const HeroCollapsedContext = createContext(false);
