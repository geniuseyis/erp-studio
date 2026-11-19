import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// reserveWaitingWorkOrdersInternal yetki denetlemez; yalnızca receiveGoods (domain) çağırabilir.
test("arayüz katmanı (src/app, src/features) reserveWaitingWorkOrdersInternal'ı içe aktarmaz", () => {
  const files = [...sources("src/app"), ...sources("src/features")];
  expect(files.length).toBeGreaterThan(20);
  const offenders = files.filter((f) => readFileSync(f, "utf8").includes("reserveWaitingWorkOrders"));
  expect(offenders).toEqual([]);
});

test("reserveWaitingWorkOrdersInternal domain içinde yalnızca receiving.ts'ten çağrılır", () => {
  const callers = sources("src/domain")
    .filter((f) => readFileSync(f, "utf8").includes("reserveWaitingWorkOrdersInternal"))
    .map((f) => f.replaceAll("\\", "/"));
  expect(callers.sort()).toEqual(["src/domain/production/workOrders.ts", "src/domain/purchasing/receiving.ts"]);
});
