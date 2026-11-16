import { auditLog } from "@/db/schema";
import type { Ctx } from "./context";

/** İşlem geçmişine "kim, neyi, ne yaptı" satırı yazar. Değişikliği yapan transaction içinde çağrılır. */
export async function logAudit(
  ctx: Ctx,
  e: { entity: string; entityId: string; action: string; summary: string },
): Promise<void> {
  await ctx.db.insert(auditLog).values({ ...e, userId: ctx.user.id, createdAt: ctx.now });
}
