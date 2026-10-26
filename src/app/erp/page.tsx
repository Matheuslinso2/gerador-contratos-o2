import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CADASTROS, ETAPAS } from "@/lib/erp/processo";

export const metadata = { title: { absolute: "ERP O2" } };

// Tela inicial do ERP O2: a barra do processo (Matheus 26/10: telas por lógica de processo, da esquerda para a
// direita) com o número que pede ação em cada etapa, e os avisos. Só contagens leves e tabelas prontas.
export default async function ErpInicio() {
  const supabase = await createClient();
  const [{ data: atrasos }, { data: alertas }, { count: revisao }, { count: emEmissao }, { count: vigentes }, { count: foraFaturas }, { count: estornos }, { count: vencDiv }] = await Promise.all([
    supabase.from("erp_baixa_corp_atraso_pronto").select("mes, seguradora, situacao"),
    supabase.rpc("erp_contar_alertas_fatura"),
    supabase.from("erp_documentos").select("id", { count: "exact", head: true }).eq("revisao_pendente", true),
    supabase.from("erp_documentos").select("id", { count: "exact", head: true }).eq("situacao", "digitado"),
    supabase.from("erp_documentos").select("id", { count: "exact", head: true }).eq("situacao", "vigente"),
    // faturas cujo boleto não bate com a soma das linhas (fora da fatura NÃO é pendência — Matheus 26/10)
    supabase.from("erp_fatura_meses").select("id", { count: "exact", head: true }).not("valor_boleto", "is", null).filter("valor_boleto", "gt", 0),
    supabase.from("erp_estornos_endosso_pronto").select("alerta", { count: "exact", head: true }),
    supabase.from("erp_vencimentos_pronto").select("parcela_id", { count: "exact", head: true }),
  ]);
  const nAtraso = (atrasos ?? []).length;
  const mesesAtraso = [...new Set((atrasos ?? []).map((a: { mes: string }) => a.mes))].sort().reverse();
  const contagem = ((alertas ?? []) as { alerta: string; n: number }[]).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.alerta]: Number(a.n) }), {});
  const avisos = [
    nAtraso > 0 && {
      cor: "border-red-200 bg-red-50 text-red-800",
      texto: `Baixa de comissão atrasada: ${nAtraso} combinações corretora × seguradora (${mesesAtraso.map((m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`).join(", ")}).`,
      href: "/erp/conferencia",
    },
    (contagem.fora_da_fatura ?? 0) + (contagem.sem_destino_seguradora ?? 0) > 0 && {
      cor: "border-orange-200 bg-orange-50 text-orange-800",
      texto: `Faturas: ${contagem.fora_da_fatura ?? 0} efetivados fora da fatura carregada e ${contagem.sem_destino_seguradora ?? 0} sem destino da seguradora há mais de 10 dias.`,
      href: "/erp/faturas",
    },
    (revisao ?? 0) > 0 && {
      cor: "border-blue-200 bg-blue-50 text-blue-800",
      texto: `${revisao} documentos vindos do Bitrix aguardando revisão do pré-cadastro.`,
      href: "/erp/documentos",
    },
  ].filter(Boolean) as { cor: string; texto: string; href: string }[];

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">ERP O2</h1>
        <p className="text-sm text-gray-600">Sistema de gestão da O2 Seguros, separado do Workspace. Até dezembro/2026 roda ao lado do Corp; a partir de 2027 substitui o Corp.</p>
      </div>
      {avisos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Pedindo atenção</h2>
          {avisos.map((a) => (
            <Link key={a.texto} href={a.href} className={`block rounded-lg border p-3 text-sm hover:underline ${a.cor}`}>
              {a.texto}
            </Link>
          ))}
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">O processo, da efetivação à renovação</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          {ETAPAS.map((e, i) => {
            const numero: Record<string, { n: number | null; rotulo: string } | undefined> = {
              emissao: { n: emEmissao ?? 0, rotulo: "em emissão" },
              faturas: { n: foraFaturas ?? 0, rotulo: "faturas-mês carregadas" },
              apolices: { n: vigentes ?? 0, rotulo: "vigentes" },
              parcelas: { n: vencDiv ?? 0, rotulo: "vencimentos divergentes" },
              baixa: { n: (atrasos ?? []).length + (estornos ?? 0), rotulo: "atrasos + estornos a ver" },
            };
            const k = numero[e.chave];
            const corpo = (
              <>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Etapa {i + 1}</p>
                <p className="font-semibold text-o2-navy">{e.label}{e.externo ? " ↗" : ""}</p>
                {k ? (
                  <p className="mt-1 text-sm"><span className="text-lg font-semibold text-o2-navy">{k.n?.toLocaleString("pt-BR")}</span> <span className="text-gray-500">{k.rotulo}</span></p>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">{e.href ? e.descricao : "em breve"}</p>
                )}
              </>
            );
            return e.href ? (
              <Link key={e.chave} href={e.href} target={e.externo ? "_blank" : undefined} className="rounded-xl border border-gray-200 bg-white p-3 transition hover:border-o2-coral hover:shadow-sm" title={e.descricao}>
                {corpo}
              </Link>
            ) : (
              <div key={e.chave} className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 opacity-70" title={e.descricao}>
                {corpo}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          Cotações ficam no Workspace; o ERP começa na efetivação. Cadastros:{" "}
          {CADASTROS.map((c, i) => (
            <span key={c.href}>{i > 0 ? " · " : ""}<Link href={c.href} className="underline">{c.label}</Link></span>
          ))}
          .
        </p>
      </section>
    </main>
  );
}
