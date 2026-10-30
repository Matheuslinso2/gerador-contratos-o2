import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buscarRegrasRepasse } from "@/lib/erp/documentos";
import { nomesProdutoDasFaturas } from "@/lib/erp/faturaTela";
import { formatarDocumento } from "@/lib/erp/clientes";
import { formatarReais } from "@/lib/sinistros/regras";
import RegrasRepasseErp from "../RegrasRepasseErp";
import InfoLegenda from "@/components/InfoLegenda";

export const metadata = { title: "Imobiliária" };
export const dynamic = "force-dynamic";

// ERP O2 — ficha de gestão da imobiliária. É a MESMA base única `imobiliarias` do Workspace e do Power BI (Matheus 28/10): o cadastro é
// editado na ficha do Workspace; aqui entra o que é pertinente ao ERP — cadastro de referência, grupo, produção vigente, propostas pendentes,
// faturas e regras de repasse. Nada é gravado por esta tela (as regras de repasse têm o próprio formulário, como antes).
type Producao = { produto: string; seguradora: string; docs: number; premio: number; comissao: number };
type Membro = { id: string; nome: string; papel_no_grupo: string | null; codigo_o2: number | null };

const lista = (v: string[] | null | undefined) => (v && v.length ? v.join(", ") : null);

function Campo({ rotulo, valor, info }: { rotulo: string; valor: React.ReactNode; info?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}{info}</div>
      <div className="text-sm text-gray-900">{valor ?? <span className="text-gray-300">—</span>}</div>
    </div>
  );
}

export default async function ErpImobiliaria({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: imob } = await supabase
    .from("imobiliarias")
    .select("id, nome, apelido, cnpj, tipo_pessoa, creci, bairro, cidade, uf, telefone, email, email_faturas, email_repasses, email_campanhas, responsavel, quantidade_imoveis, codigo_o2, codigo_produtor_corp, fatura_habilitada, fatura_habilitada_em, centralizador_power_bi, origem_comercial, receita_situacao, receita_consultada_em, grupo_id, papel_no_grupo, grupo:imobiliaria_grupos(nome, tipo), canal:erp_canais(nome)")
    .eq("id", id)
    .maybeSingle();
  if (!imob) notFound();
  const grupo = imob.grupo as unknown as { nome: string; tipo: string } | null;
  const canal = imob.canal as unknown as { nome: string } | null;

  const [regras, { data: pl }, { data: resumo }, { data: prodBruta }, { data: faturas }, { data: membrosBrutos }] = await Promise.all([
    buscarRegrasRepasse(supabase, id),
    supabase.from("erp_repasse_direto_seguradora").select("pct, confirmado, fonte, observacao, seguradora:erp_seguradoras(nome)").eq("imobiliaria_id", id),
    supabase.from("erp_imobiliarias_resumo").select("docs_total, docs_vigentes, premio_vigente, comissao_vigente, propostas_pendentes, faturas, ultima_vigencia, calculado_em").eq("imobiliaria_id", id).maybeSingle(),
    supabase.rpc("erp_imobiliaria_producao", { p_id: id }),
    supabase.from("erp_faturas").select("id, seguradora, chave, codigo_corretor, corretora, ramo").eq("imobiliaria_id", id).order("seguradora"),
    imob.grupo_id ? supabase.from("imobiliarias").select("id, nome, papel_no_grupo, codigo_o2").eq("grupo_id", imob.grupo_id).order("nome").limit(60) : Promise.resolve({ data: [] }),
  ]);
  const proLabore = (pl ?? []) as unknown as { pct: number; confirmado: boolean; fonte: string; observacao: string | null; seguradora: { nome: string } | null }[];
  const producao = ((prodBruta ?? []) as { produto: string; seguradora: string; docs: number | string; premio: number | string; comissao: number | string }[]).map((p): Producao => ({ produto: p.produto, seguradora: p.seguradora, docs: Number(p.docs), premio: Number(p.premio), comissao: Number(p.comissao) }));
  const membros = ((membrosBrutos ?? []) as Membro[]).filter((m) => m.id !== id);
  const faturaAtiva = (faturas ?? []).length > 0;
  const nomesProduto = await nomesProdutoDasFaturas(supabase, (faturas ?? []).map((f: { id: string }) => f.id));

  return (
    <main className="mx-auto w-full max-w-[1000px] flex-1 space-y-6 p-8">
      <div className="space-y-1">
        <Link href="/erp/imobiliarias" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">← Imobiliárias</Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold text-o2-navy">{imob.nome}</h1>
          {grupo && <span className="rounded-full bg-o2-navy px-2.5 py-0.5 text-[11px] font-medium text-white">grupo {grupo.nome}{imob.papel_no_grupo ? ` · ${imob.papel_no_grupo}` : ""}</span>}
        </div>
        <p className="text-sm text-gray-600">
          {resumo?.docs_total ?? 0} documentos no ERP ·{" "}
          <Link href={`/erp/documentos?imobiliaria=${encodeURIComponent(imob.nome)}`} className="underline">ver documentos</Link> ·{" "}
          <Link href={`/erp/emissao?imobiliaria=${encodeURIComponent(imob.nome)}`} className="underline">propostas em emissão</Link> ·{" "}
          <Link href={`/admin/imobiliarias/${id}`} className="underline">editar o cadastro no Workspace ↗</Link>
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-4">
        <Campo rotulo="Apólices vigentes" valor={(resumo?.docs_vigentes ?? 0).toLocaleString("pt-BR")} info={<InfoLegenda titulo="Apólices vigentes">Quantidade de apólices vigentes desta imobiliária no ERP. O resumo é recalculado a cada hora.</InfoLegenda>} />
        <Campo rotulo="Prêmio vigente" valor={resumo?.docs_vigentes ? formatarReais(Number(resumo.premio_vigente)) : null} info={<InfoLegenda titulo="Prêmio vigente">Soma do prêmio das apólices vigentes desta imobiliária no ERP. Fica em branco quando não há apólice vigente.</InfoLegenda>} />
        <Campo rotulo="Comissão vigente" valor={resumo?.docs_vigentes ? formatarReais(Number(resumo.comissao_vigente)) : null} info={<InfoLegenda titulo="Comissão vigente">Soma da comissão das apólices vigentes desta imobiliária no ERP. Fica em branco quando não há apólice vigente.</InfoLegenda>} />
        <Campo rotulo="Propostas pendentes de emissão" valor={resumo?.propostas_pendentes ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">{resumo.propostas_pendentes}</span> : "0"} info={<InfoLegenda titulo="Propostas pendentes de emissão" alinhar="direita">Quantidade de propostas desta imobiliária que ainda não viraram apólice, ou seja, aguardam emissão. O link propostas em emissão, no alto da página, abre a lista.</InfoLegenda>} />
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Cadastro (base única, só leitura aqui)<InfoLegenda titulo="Cadastro">Dados do cadastro único de imobiliárias, o mesmo do Workspace e do Power BI. Aqui só se lê; para corrigir, use o link editar o cadastro no Workspace. Cód. O2 da imobiliária é o código dela na O2; Cód. da imobiliária no Corp é o código dela como produtor no Corp; Grupo no Power BI é o nome usado para juntar fichas no Power BI. Os e-mails de fatura e de repasse são os usados nesses envios, e a situação na Receita é a da última consulta registrada.</InfoLegenda></h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Campo rotulo="CNPJ / CPF" valor={imob.cnpj ? `${formatarDocumento(imob.cnpj)}${imob.tipo_pessoa ? ` · ${imob.tipo_pessoa.toLowerCase()}` : ""}` : null} />
          <Campo rotulo="Cód. O2 da imobiliária (produtor)" valor={imob.codigo_o2 ?? null} />
          <Campo rotulo="Cód. da imobiliária no Corp (produtor)" valor={imob.codigo_produtor_corp ?? null} />
          <Campo rotulo="Grupo no Power BI" valor={imob.centralizador_power_bi} />
          <Campo rotulo="Canal / origem" valor={[canal?.nome, imob.origem_comercial].filter(Boolean).join(" · ") || null} />
          <Campo rotulo="Cidade" valor={[imob.bairro, imob.cidade, imob.uf].filter(Boolean).join(" · ") || null} />
          <Campo rotulo="Telefone" valor={imob.telefone} />
          <Campo rotulo="Responsável" valor={imob.responsavel} />
          <Campo rotulo="Imóveis administrados" valor={imob.quantidade_imoveis?.toLocaleString("pt-BR") ?? null} />
          <Campo rotulo="E-mail" valor={imob.email} />
          <Campo rotulo="E-mails de fatura" valor={lista(imob.email_faturas)} />
          <Campo rotulo="E-mails de repasse" valor={lista(imob.email_repasses)} />
          <Campo rotulo="Situação na Receita" valor={imob.receita_situacao ? `${imob.receita_situacao}${imob.receita_consultada_em ? ` (consulta em ${imob.receita_consultada_em.slice(8, 10)}/${imob.receita_consultada_em.slice(5, 7)}/${imob.receita_consultada_em.slice(0, 4)})` : ""}` : null} />
        </div>
        {!lista(imob.email_faturas) && faturaAtiva && <p className="text-[11px] text-orange-700">Tem fatura, mas nenhum e-mail de fatura cadastrado: o envio da fatura não tem para onde ir.</p>}
      </section>

      {grupo && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Grupo {grupo.nome} ({grupo.tipo === "rede_filiais" ? "rede de filiais" : "mesma empresa"})<InfoLegenda titulo="Grupo">Lista as outras fichas do cadastro único que pertencem ao mesmo grupo (até 60), com o papel de cada uma e o código O2 da imobiliária. O grupo pode ser uma rede de filiais ou fichas diferentes da mesma empresa.</InfoLegenda></h2>
          {membros.length === 0 ? (
            <p className="text-xs text-gray-500">Esta é a única ficha do grupo.</p>
          ) : (
            <ul className="grid gap-1 text-xs md:grid-cols-2">
              {membros.map((m) => (
                <li key={m.id}>
                  <Link href={`/erp/imobiliarias/${m.id}`} className="text-o2-navy hover:underline">{m.nome}</Link>
                  <span className="text-gray-400"> · {m.papel_no_grupo ?? "sem papel"} · cód. {m.codigo_o2 ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Produção vigente por produto e seguradora<InfoLegenda titulo="Produção vigente">Apólices vigentes desta imobiliária no ERP, agrupadas por produto e seguradora, com a quantidade, a soma do prêmio e a soma da comissão de cada grupo.</InfoLegenda></h2>
        {producao.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhuma apólice vigente.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr><th className="py-1 pr-3">Produto</th><th className="py-1 pr-3">Seguradora</th><th className="py-1 pr-3 text-right">Apólices</th><th className="py-1 pr-3 text-right">Prêmio</th><th className="py-1 pr-3 text-right">Comissão</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {producao.map((p) => (
                <tr key={`${p.produto}-${p.seguradora}`}>
                  <td className="py-1 pr-3">{p.produto}</td>
                  <td className="py-1 pr-3">{p.seguradora}</td>
                  <td className="py-1 pr-3 text-right">{p.docs.toLocaleString("pt-BR")}</td>
                  <td className="py-1 pr-3 text-right">{formatarReais(p.premio)}</td>
                  <td className="py-1 pr-3 text-right">{formatarReais(p.comissao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Faturas<InfoLegenda titulo="Faturas">Fatura é a aglutinação de várias apólices em uma cobrança só. Lista as faturas desta imobiliária cadastradas no ERP, por seguradora, com a corretora e o código do corretor; clicar abre a fatura. Sem fatura, as apólices são cobradas direto, por boleto, cartão ou débito.</InfoLegenda></h2>
        {!faturaAtiva ? (
          <p className="text-xs text-gray-500">Sem fatura carregada: as apólices desta imobiliária são cobradas direto (boleto, cartão ou débito).</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {(faturas ?? []).map((f: { id: string; seguradora: string; chave: string; codigo_corretor: string | null; corretora: string | null; ramo: string | null }) => (
              <li key={f.id}>
                <Link href={`/erp/faturas/${f.id}`} className="text-o2-navy hover:underline">{f.seguradora}{nomesProduto.get(f.id) ? ` · ${nomesProduto.get(f.id)}` : ""}</Link>
                <span className="text-gray-400"> · {f.corretora ?? "corretora não informada"}{f.codigo_corretor ? ` · código ${f.codigo_corretor}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RegrasRepasseErp
        regras={regras}
        codigoO2={imob.codigo_o2 ?? null}
        codigoCorp={imob.codigo_produtor_corp ?? null}
        faturaHabilitada={faturaAtiva || !!imob.fatura_habilitada}
        faturaHabilitadaEm={imob.fatura_habilitada_em ?? null}
      />

      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Pró-labore pago direto pela seguradora<InfoLegenda titulo="Pró-labore pago direto">A seguradora paga esta fatia direto à imobiliária, com nota fiscal da imobiliária. Por isso não entra na conta da O2, não é pendência de comissão e não pode gerar repasse da O2. A tabela mostra a seguradora, os pontos, se o valor está confirmado ou ainda a confirmar e como foi apurado.</InfoLegenda></h2>
        <p className="text-xs text-gray-500">
          A seguradora paga esta fatia direto à imobiliária (NF da imob): não entra na conta da O2, não é pendência de comissão e não pode gerar repasse da O2.
        </p>
        {proLabore.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-1 pr-3">Seguradora</th>
                <th className="py-1 pr-3 text-right">Pontos</th>
                <th className="py-1 pr-3">Situação</th>
                <th className="py-1 pr-3">Como foi apurado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {proLabore.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3">{r.seguradora?.nome ?? "—"}</td>
                  <td className="py-1 pr-3 text-right">{Number(r.pct)}</td>
                  <td className="py-1 pr-3">{r.confirmado ? <span className="text-green-700">confirmado</span> : <span className="text-orange-700">a confirmar</span>}</td>
                  <td className="py-1 pr-3 text-gray-500">{r.observacao ?? r.fonte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {resumo?.calculado_em && <p className="text-[11px] text-gray-400">Resumo da produção atualizado a cada hora (última atualização {new Date(resumo.calculado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}).</p>}
    </main>
  );
}
