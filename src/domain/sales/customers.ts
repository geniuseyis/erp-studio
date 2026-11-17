import { eq, like } from "drizzle-orm";
import { CUSTOMER_KINDS, customers } from "@/db/schema";
import { describeChanges, type FieldSpec, logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { asCustomer, type Customer, type CustomerKind } from "./types";

export type NewCustomer = {
  name: string;
  kind: CustomerKind;
  city: string;
  district: string;
  phone: string;
  paymentTermDays: number;
};

const CODE_PREFIX = "MUS-";

const KIND_TEXT: Record<CustomerKind, string> = { bireysel: "bireysel", kurumsal: "kurumsal" };
const days = (n: number) => `${n} gün`;

/** Güncelleme özetinde alanların adı ve yazılışı, formdaki sırayla. */
const FIELDS: FieldSpec<NewCustomer> = {
  name: { label: "ad" },
  kind: { label: "tür", format: (k) => KIND_TEXT[k] },
  city: { label: "il" },
  district: { label: "ilçe" },
  phone: { label: "telefon" },
  paymentTermDays: { label: "vade", format: days },
};

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

/** Yalnızca rakam, boşluk ve +; en az 10, en çok 13 rakam. */
function checkPhone(phone: string): void {
  const digits = phone.replace(/\D/g, "").length;
  if (!/^[\d\s+]+$/.test(phone) || digits < 10 || digits > 13) {
    throw invalid("Telefon yalnızca rakam, boşluk ve + içermeli (10-13 rakam)");
  }
}

function clean(i: Partial<NewCustomer>): Partial<NewCustomer> {
  const out: Partial<NewCustomer> = {};
  if (i.name !== undefined) {
    if (!i.name.trim()) throw invalid("Ad boş olamaz");
    out.name = i.name.trim();
  }
  if (i.kind !== undefined) {
    if (!(CUSTOMER_KINDS as readonly string[]).includes(i.kind)) throw invalid("Geçersiz müşteri türü");
    out.kind = i.kind;
  }
  if (i.city !== undefined) {
    if (!i.city.trim()) throw invalid("İl boş olamaz");
    out.city = i.city.trim();
  }
  if (i.district !== undefined) {
    if (!i.district.trim()) throw invalid("İlçe boş olamaz");
    out.district = i.district.trim();
  }
  if (i.phone !== undefined) {
    checkPhone(i.phone);
    out.phone = i.phone.trim();
  }
  if (i.paymentTermDays !== undefined) {
    if (!Number.isInteger(i.paymentTermDays) || i.paymentTermDays < 0) throw invalid("Vade sıfır ya da daha büyük gün olmalı");
    out.paymentTermDays = i.paymentTermDays;
  }
  return out;
}

export async function createCustomer(ctx: Ctx, input: NewCustomer): Promise<Customer> {
  assertCan(ctx.user, "sales", "write");
  const v = clean(input) as NewCustomer;

  return inTx(ctx, async (tx) => {
    const existing = await tx.db.select({ code: customers.code }).from(customers).where(like(customers.code, `${CODE_PREFIX}%`));
    const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(CODE_PREFIX.length)) || 0), 0);
    const code = `${CODE_PREFIX}${String(max + 1).padStart(4, "0")}`;
    const [row] = await tx.db
      .insert(customers)
      .values({ ...v, code, createdAt: tx.now })
      .returning();
    if (!row) throw new Error("müşteri eklenemedi");
    await logAudit(tx, {
      entity: "customer",
      entityId: row.id,
      action: "create",
      summary: `${code} ${v.name} eklendi: ${KIND_TEXT[v.kind]}, ${v.city} / ${v.district}, ${v.phone}, vade ${days(v.paymentTermDays)}`,
    });
    return asCustomer(row);
  });
}

export async function updateCustomer(ctx: Ctx, id: string, patch: Partial<NewCustomer>): Promise<void> {
  assertCan(ctx.user, "sales", "write");
  const set = clean(patch);
  await inTx(ctx, async (tx) => {
    const [row] = isUuid(id) ? await tx.db.select().from(customers).where(eq(customers.id, id)) : [];
    if (!row) throw new DomainError("NOT_FOUND", "Müşteri bulunamadı");
    const changes = describeChanges(FIELDS, asCustomer(row), set);
    if (changes.length === 0) return;
    await tx.db.update(customers).set(set).where(eq(customers.id, id));
    await logAudit(tx, { entity: "customer", entityId: id, action: "update", summary: `${row.code} güncellendi: ${changes.join(", ")}` });
  });
}
