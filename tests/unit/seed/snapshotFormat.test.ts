import { asc } from "drizzle-orm";
import { expect, test } from "vitest";
import { settings } from "@/db/schema";
import { exportSnapshot, loadSnapshot } from "@/seed/snapshot";
import { createTestDb } from "../../helpers/testDb";

test("json sütunları olduğu gibi döner: sayı, uuid metni, nesne ve mantıksal değer", async () => {
  const uuid = "0b6f4c1e-8a2d-4f3b-9c5e-7d1a2b3c4d5e";
  const values = [
    { key: "a", value: 0 },
    { key: "b", value: uuid },
    { key: "c", value: { id: uuid, n: 42, list: [1, uuid] } },
    { key: "d", value: true },
    { key: "e", value: 7 },
  ];
  const source = await createTestDb({ fresh: true });
  await source.insert(settings).values(values);
  const now = new Date("2026-11-15T09:00:00+03:00");
  const copy = await createTestDb({ fresh: true });
  await loadSnapshot(copy, await exportSnapshot(source, now), now);
  expect(await copy.select().from(settings).orderBy(asc(settings.key))).toEqual(values);
});
