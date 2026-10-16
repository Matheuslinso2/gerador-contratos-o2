import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { validarPassePanorama } from "@/lib/bitrix/sessaoPanorama";

// Quem pode mexer no Panorama de Preços: colaborador logado no Workspace
// (sessão Supabase, respeita RLS) OU quem abriu a aba "Panorama" dentro do
// card do Bitrix (passe HMAC do card -- sem sessão Supabase, então usa o
// cliente service role, sempre restrito ao card do passe).
export async function autorizarPanorama(
  cardId: number,
  passeBitrix?: string | null
): Promise<{ email: string; db: SupabaseClient; viaBitrix: boolean } | null> {
  if (passeBitrix) {
    const email = validarPassePanorama(passeBitrix, cardId);
    return email ? { email, db: createServiceClient(), viaBitrix: true } : null;
  }
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user?.email || (!isAdmin(user.email) && !isColaboradorO2(user.email))) return null;
  return { email: user.email, db, viaBitrix: false };
}
