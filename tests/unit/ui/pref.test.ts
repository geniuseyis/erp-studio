import { afterEach, describe, expect, it, vi } from "vitest";
import { clampHeight, defaultHeroCollapsed, parseHeight, readPref, resolveHeroCollapsed, screenKey, TABLE_MAX, TABLE_MIN, writePref } from "@/ui/pref";

afterEach(() => vi.unstubAllGlobals());

describe("kişisel ayar deposu", () => {
  it("depo engelliyken okuma ve yazma istisna fırlatmaz", () => {
    const blocked = {
      getItem() {
        throw new DOMException("engellendi", "SecurityError");
      },
      setItem() {
        throw new DOMException("dolu", "QuotaExceededError");
      },
      removeItem() {
        throw new DOMException("engellendi", "SecurityError");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked });
    expect(readPref("erp:hero:islemler")).toBeNull();
    expect(writePref("erp:hero:islemler", "1")).toBe(false);
    expect(writePref("erp:hero:islemler", null)).toBe(false);
  });

  it("depo hiç yokken (window tanımsız) de sessiz kalır", () => {
    expect(readPref("x")).toBeNull();
    expect(writePref("x", "1")).toBe(false);
  });

  it("çalışan depoda yazılan değer okunur, null siler", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) },
    });
    expect(writePref("erp:table-h:islemler", "480")).toBe(true);
    expect(readPref("erp:table-h:islemler")).toBe("480");
    writePref("erp:table-h:islemler", null);
    expect(readPref("erp:table-h:islemler")).toBeNull();
  });
});

describe("tablo yüksekliği", () => {
  it("sınırlar içinde tutulur ve yuvarlanır", () => {
    expect(clampHeight(10)).toBe(TABLE_MIN);
    expect(clampHeight(99999)).toBe(TABLE_MAX);
    expect(clampHeight(400.6)).toBe(401);
  });

  it("bozuk kayıt otomatik boyuta döner", () => {
    expect(parseHeight(null)).toBeNull();
    expect(parseHeight("abc")).toBeNull();
    expect(parseHeight("-5")).toBeNull();
    expect(parseHeight("480")).toBe(480);
    expect(parseHeight("90")).toBe(TABLE_MIN);
  });
});

describe("özet bandı varsayılanı", () => {
  it("dar ekranda ya da alçak pencerede daraltılır, aksi halde açıktır", () => {
    expect(defaultHeroCollapsed(390, 900)).toBe(true);
    expect(defaultHeroCollapsed(1440, 800)).toBe(true);
    expect(defaultHeroCollapsed(1440, 900)).toBe(false);
    expect(defaultHeroCollapsed(768, 820)).toBe(false);
  });

  it("kayıtlı seçim varsayılanı geçersiz kılar", () => {
    expect(resolveHeroCollapsed("0", 390, 600)).toBe(false);
    expect(resolveHeroCollapsed("1", 1440, 900)).toBe(true);
    expect(resolveHeroCollapsed("x", 1440, 900)).toBe(false);
  });

  it("ekran anahtarı yol adından türer", () => {
    expect(screenKey("/islemler")).toBe("islemler");
    expect(screenKey("/stok/malzemeler/")).toBe("stok/malzemeler");
    expect(screenKey("/")).toBe("ana");
  });
});
