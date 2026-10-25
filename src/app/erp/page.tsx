import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Início" };

// Tela inicial do ERP O2: atalhos para as áreas e o que está pedindo atenção agora.
// Lê só tabelas prontas/contagens leves (regra de desempenho do Workspace).
const AREAS = [
  { href: "/erp/documentos", titulo: "Documentos", texto: "Propostas, apólices, endossos e renovações com o Código O2, a família de renovações e a origem no Bitrix." },
  { href: "/erp/baixas", titulo: "Baixas de comissão", texto: "Extratos das seguradoras conferidos apólice por apólice, aprovação da baixa e lista pronta para o Corp (InCorp)." },
  { href: "/erp/conferencia", titulo: "Conferência", texto: "ERP × Corp × Power BI, alertas de fatura, baixa mensal no formato da planilha e baixa atrasada." },
  { href: "/erp/imobiliarias", titulo: "Imobiliárias", texto: "Código O2 do produtor, modo fatura, regras de repasse e pró-labore pago direto pela seguradora." },
  { href: "/erp/seguradoras", titulo: "Seguradoras", texto: "Regra de comissão (proporcional × esgotamento) por seguradora e produto." },
];

export default async function ErpInicio() {
  const supabase = await createClient();
  const [{ data: atrasos }, { data: alertas }, { count: revisao }] = await Promise.all([
    supabase.from("erp_baixa_corp_atraso_pronto").select("mes, seguradora, situacao"),
    supabase.rpc("erp_contar_alertas_fatura"),
    supabase.from("erp_documentos").select("id", { count: "exact", head: true }).eq("revisao_pendente", true),
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
      href: "/erp/conferencia",
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
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((a) => (
          <Link key={a.href} href={a.href} className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-o2-coral hover:shadow-sm">
            <p className="font-semibold text-o2-navy">{a.titulo}</p>
            <p className="mt-1 text-sm text-gray-600">{a.texto}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
