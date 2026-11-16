import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("src/ui/tokens.css", "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} bloğu yok`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1] as string] = m[2] as string;
  return out;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Metin çiftleri WCAG AA (4.5:1); odak halkası ve çizgiler gibi metin olmayan öğeler 3:1.
const TEXT_PAIRS: [string, string][] = [
  ["fg", "bg"],
  ["fg", "surface"],
  ["fg", "surface-2"],
  ["fg-muted", "bg"],
  ["fg-muted", "surface"],
  ["fg-muted", "surface-2"],
  ["accent", "surface"],
  ["accent", "bg"],
  ["accent-fg", "accent"],
  ["ok", "ok-bg"],
  ["warn", "warn-bg"],
  ["danger", "danger-bg"],
  ["info", "info-bg"],
  ["danger", "surface"],
  ["sidebar-fg", "sidebar-bg"],
  ["sidebar-fg-muted", "sidebar-bg"],
  ["sidebar-fg", "sidebar-active"],
  // Başlık bandının gradyanı boyunca metin her noktada okunur kalmalı.
  ["hero-fg", "hero-from"],
  ["hero-fg", "hero-via"],
  ["hero-fg", "hero-to"],
  ["hero-fg-muted", "hero-from"],
  ["hero-fg-muted", "hero-via"],
  ["hero-fg-muted", "hero-to"],
];
const NON_TEXT_PAIRS: [string, string][] = [
  ["focus", "bg"],
  ["focus", "surface"],
  ["focus", "sidebar-bg"],
  ["line-strong", "surface"],
  ["honey", "hero-via"],
];

for (const [name, selector] of [
  ["açık", ":root"],
  ["koyu", ':root[data-theme="dark"]'],
] as const) {
  const t = tokens(selector);

  test(`${name} tema bütün belirteçleri tanımlar`, () => {
    const light = Object.keys(tokens(":root")).sort();
    expect(Object.keys(t).sort()).toEqual(light);
    expect(light.length).toBeGreaterThanOrEqual(24);
  });

  test.each(TEXT_PAIRS)(`${name} tema: %s / %s metin kontrastı AA`, (fg, bg) => {
    expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(NON_TEXT_PAIRS)(`${name} tema: %s / %s en az 3:1`, (fg, bg) => {
    expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(3);
  });
}
