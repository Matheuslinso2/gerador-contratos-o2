import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMatheus } from "@/lib/admin";
import { listarMensagens } from "@/lib/gestaoEmails/gmail";
import { classificarEmailsExecutivos } from "@/lib/gestaoEmails/classificador";

// Rota temporária pra validar a Fase 3 (classificação por IA) de ponta a
// ponta antes de construir a tela. Remover junto com /teste depois que a
// página em src/app/gestao-emails existir.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isMatheus(user?.email)) {
    return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 403 });
  }

  try {
    const mensagens = await listarMensagens({ query: "in:inbox newer_than:7d", maxResultados: 30 });
    const classificacoes = await classificarEmailsExecutivos(mensagens);

    const porId = new Map(mensagens.map((m) => [m.id, m]));
    const relevantes = classificacoes
      .filter((c) => c.categoria !== "ruido")
      .map((c) => {
        const mensagem = porId.get(c.messageId);
        return {
          categoria: c.categoria,
          status: c.status,
          resumoExecutivo: c.resumoExecutivo,
          acaoExigida: c.acaoExigida,
          remetente: mensagem?.remetente,
          assunto: mensagem?.assunto,
          data: mensagem?.data,
        };
      });

    // Diagnóstico: lista TODOS os e-mails com a categoria que a IA deu (ou
    // "SEM_CLASSIFICACAO" se o messageId nem bateu com nenhum retornado) --
    // ajuda a distinguir "IA decidiu que é ruído" de "bug de correspondência
    // entre a mensagem e a classificação".
    const classificacoesPorId = new Map(classificacoes.map((c) => [c.messageId, c]));
    const diagnostico = mensagens.map((m) => ({
      id: m.id,
      remetente: m.remetente,
      assunto: m.assunto,
      categoria: classificacoesPorId.get(m.id)?.categoria ?? "SEM_CLASSIFICACAO",
    }));

    return NextResponse.json({
      ok: true,
      totalLidos: mensagens.length,
      totalRelevantes: relevantes.length,
      totalFiltrados: mensagens.length - relevantes.length,
      relevantes,
      diagnostico,
    });
  } catch (erro) {
    return NextResponse.json(
      { ok: false, erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 }
    );
  }
}
