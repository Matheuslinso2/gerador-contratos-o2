import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarEmail } from "@/lib/email";

// Pedido do Matheus, 07/10/2026: aviso interno com controle de quem abriu.
// Cada pessoa da equipe recebe o PRÓPRIO e-mail (antes era um envio só com
// todo mundo no "to", um único id no Resend e nenhum jeito de saber quem
// abriu) e cada envio vira uma linha em avisos_internos_envios, casada de
// volta com o webhook de abertura pelo resend_email_id.

// Mesma cadência do envio de campanhas (~2,5 e-mails/s) pra não estourar o
// limite de requisições do Resend.
const INTERVALO_ENTRE_ENVIOS_MS = 350;
// Server action roda dentro do limite de 60s da Vercel -- para antes disso
// e deixa o resto "pendente", que dá pra mandar depois pelo botão "Enviar
// para quem faltou" da tela do aviso.
const ORCAMENTO_DE_TEMPO_MS = 45_000;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResultadoEnvioAviso = {
  enviados: number;
  falhas: number;
  restantes: number;
  primeiroErro: string | null;
};

// Manda para todos os envios do aviso que ainda estão "pendente" ou
// "falhou" (primeiro disparo e "enviar para quem faltou" usam a mesma
// função).
export async function enviarPendentesDoAviso(
  supabase: SupabaseClient,
  aviso: { id: string; assunto: string; html: string }
): Promise<ResultadoEnvioAviso> {
  const { data: alvos } = await supabase
    .from("avisos_internos_envios")
    .select("id, email")
    .eq("aviso_id", aviso.id)
    .in("status", ["pendente", "falhou"])
    .order("created_at", { ascending: true });

  const inicio = Date.now();
  let enviados = 0;
  let falhas = 0;
  let tentados = 0;
  let primeiroErro: string | null = null;

  for (const alvo of alvos ?? []) {
    if (Date.now() - inicio > ORCAMENTO_DE_TEMPO_MS) break;
    tentados++;

    try {
      const { id: resendEmailId } = await enviarEmail({
        para: alvo.email,
        assunto: aviso.assunto,
        html: aviso.html,
        remetente: "O2 Seguros",
        throwSeFalhar: true,
      });
      await supabase
        .from("avisos_internos_envios")
        .update({ status: "enviado", enviado_em: new Date().toISOString(), resend_email_id: resendEmailId, erro_detalhe: null })
        .eq("id", alvo.id);
      enviados++;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      primeiroErro ??= mensagem;
      await supabase.from("avisos_internos_envios").update({ status: "falhou", erro_detalhe: mensagem }).eq("id", alvo.id);
      falhas++;
    }

    await aguardar(INTERVALO_ENTRE_ENVIOS_MS);
  }

  return { enviados, falhas, restantes: (alvos?.length ?? 0) - tentados, primeiroErro };
}
