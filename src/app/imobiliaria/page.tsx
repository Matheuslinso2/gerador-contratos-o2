import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { salvarImobiliaria } from "./actions";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";
import CampoCnpj from "@/components/CampoCnpj";
import CampoEndereco from "@/components/CampoEndereco";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";
import { adicionarMembroImobiliaria, removerMembroImobiliaria } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImobiliariaPage({
  searchParams,
}: {
  searchParams: Promise<{ sucesso?: string; erro?: string }>;
}) {
  const { sucesso, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);

  const { data: membros } = imobiliaria
    ? await supabase.from("imobiliaria_membros").select("id, email, criado_em").eq("imobiliaria_id", imobiliaria.id).order("criado_em")
    : { data: null };

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-8 p-8">
      <div className="space-y-2">
        <BackLink />
        <h1 className="text-xl font-semibold text-o2-navy">
          {imobiliaria ? "Configuração da imobiliária" : "Complete o cadastro da sua imobiliária"}
        </h1>
      </div>

      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
      )}

      {imobiliaria?.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imobiliaria.logo_url} alt="Logo" className="h-16 object-contain" />
      )}

      <ChecklistCadastro imobiliaria={imobiliaria} />

      <form action={salvarImobiliaria} className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">1. Dados da imobiliária</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm text-gray-600">Nome da imobiliária *</label>
              <input
                name="nome"
                placeholder="Nome da imobiliária"
                required
                defaultValue={imobiliaria?.nome}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">CNPJ *</label>
              <CampoCnpj defaultValue={imobiliaria?.cnpj} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm text-gray-600">CRECI</label>
              <input
                name="creci"
                placeholder="CRECI"
                defaultValue={imobiliaria?.creci ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">Telefone de contato</label>
              <input
                name="telefone"
                placeholder="Telefone de contato"
                defaultValue={imobiliaria?.telefone ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
            </div>
          </div>
          <CampoEndereco
            name="endereco"
            label="Endereço do escritório"
            defaultValue={imobiliaria?.endereco ?? ""}
          />
          <div>
            <label className="text-sm text-gray-600">
              Logo da imobiliária (opcional, aparece no Word gerado)
            </label>
            <input name="logo" type="file" accept="image/*" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none" />
          </div>
        </section>

        <section className="space-y-3 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">2. Contrato-base</h2>
          <div>
            <label className="text-sm text-gray-600">
              Enviar o contrato-base em Word ou PDF (opcional — extrai o texto automaticamente e preenche o campo abaixo)
            </label>
            <input
              name="contrato_arquivo"
              type="file"
              accept=".docx,.pdf"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              Aceita .docx ou .pdf (com texto selecionável — PDF escaneado sem texto não funciona aqui). Se enviar um
              arquivo, ele substitui o texto digitado abaixo.
            </p>
          </div>

          <textarea
            name="texto_base_contrato"
            placeholder="Ou cole aqui o texto-base do contrato (comum a todas as locações)"
            rows={6}
            defaultValue={imobiliaria?.texto_base_contrato ?? ""}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <p className="text-xs text-gray-500">
            Pode colar um contrato real que já usa — ao salvar, o sistema identifica sozinho os
            nomes das partes, endereço do imóvel, valores e datas específicos desse contrato e
            transforma em marcadores reutilizáveis, além de remover uma eventual cláusula de
            garantia já embutida (ela é anexada à parte, escolhida em cada contrato). Se preferir
            controlar manualmente, pode usar os códigos{" "}
            <code className="rounded bg-gray-100 px-1">{"{{locador}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{locatario}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{endereco_imovel}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{valor_aluguel}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{data_inicio}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{data_termino}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{prazo_meses}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{dia_vencimento}}"}</code>,{" "}
            <code className="rounded bg-gray-100 px-1">{"{{valor_aluguel_extenso}}"}</code> e{" "}
            <code className="rounded bg-gray-100 px-1">{"{{prazo_meses_extenso}}"}</code> (pro
            valor/prazo por extenso, ex: &quot;dois mil e oitocentos reais&quot;) direto no texto —
            o sistema substitui pelo valor de cada locação ao gerar o contrato.
          </p>
        </section>

        <section className="space-y-3 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
            3. Cláusulas de Fiador e Caução (opcional)
          </h2>
          <p className="text-xs text-gray-500">
            Diferente das garantias por seguro (cadastradas pela O2), Fiador e Caução não têm um
            texto único — cada imobiliária usa o seu. Preencha só se for oferecer essas garantias
            aos seus clientes; o texto entra automaticamente no contrato quando essa opção for
            escolhida.
          </p>
          <div>
            <label className="text-sm text-gray-600">Cláusula de Fiador</label>
            <textarea
              name="clausula_fiador"
              placeholder="Texto da cláusula de garantia por Fiador"
              rows={4}
              defaultValue={imobiliaria?.clausula_fiador ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Cláusula de Caução</label>
            <textarea
              name="clausula_caucao"
              placeholder="Texto da cláusula de garantia por Caução"
              rows={4}
              defaultValue={imobiliaria?.clausula_caucao ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
        </section>

        <section className="space-y-3 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
            4. Configurações financeiras e de assinatura
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-sm text-gray-600">Índice de reajuste padrão</label>
              <select
                name="indice_reajuste"
                required
                defaultValue={imobiliaria?.indice_reajuste ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              >
                <option value="">Selecione...</option>
                <option value="IGPM">IGPM</option>
                <option value="IPCA">IPCA</option>
                <option value="IGP-DI">IGP-DI</option>
                <option value="O maior entre IGPM e IPCA">O maior entre IGPM e IPCA</option>
                <option value="Outro">Outro (ajustar depois)</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600">Plataforma de assinatura eletrônica</label>
              <select
                name="plataforma_assinatura"
                defaultValue={imobiliaria?.plataforma_assinatura ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              >
                <option value="">Selecione...</option>
                <option value="Clicksign">Clicksign</option>
                <option value="D4Sign">D4Sign</option>
                <option value="IntelliSign">IntelliSign</option>
                <option value="Outro">Outra</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className="text-sm text-gray-600">% multa por atraso</label>
              <input
                name="percentual_multa_atraso"
                type="number"
                step="0.01"
                required
                defaultValue={imobiliaria?.percentual_multa_atraso ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">% juros de mora (ao mês)</label>
              <input
                name="percentual_juros_mora"
                type="number"
                step="0.01"
                required
                defaultValue={imobiliaria?.percentual_juros_mora ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600">% honorários advocatícios</label>
              <input
                name="percentual_honorarios_advocaticios"
                type="number"
                step="0.01"
                required
                defaultValue={imobiliaria?.percentual_honorarios_advocaticios ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            O dia de vencimento do aluguel agora é definido em cada contrato (na tela "Gerar
            contrato"), já que pode variar de locação para locação.
          </p>
        </section>

        <div className="flex items-center gap-3">
          <button
            className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
            type="submit"
          >
            Salvar imobiliária
          </button>
          <Link
            href="/"
            className="rounded-full border border-gray-300 px-6 py-2.5 font-medium text-o2-navy transition hover:bg-gray-50"
          >
            Ir para o início
          </Link>
        </div>
      </form>

      {sucesso && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          Cadastro atualizado com sucesso!
        </p>
      )}

      {imobiliaria && (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Funcionários com acesso</h2>
          <p className="text-xs text-gray-500">
            Adicione o e-mail de quem mais na imobiliária deve acessar esse cadastro — assim que a pessoa criar
            conta (ou já tiver uma) com esse e-mail exato, ela passa a ver e editar tudo por aqui, igual a você.
          </p>

          <ul className="space-y-1">
            {(membros ?? []).length === 0 && <li className="text-sm text-gray-400">Nenhum funcionário adicionado ainda.</li>}
            {(membros ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                <span className="text-o2-navy">{m.email}</span>
                <form action={removerMembroImobiliaria}>
                  <input type="hidden" name="membro_id" value={m.id} />
                  <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                    Remover
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <form action={adicionarMembroImobiliaria} className="flex gap-2">
            <input
              type="email"
              name="email"
              required
              placeholder="email@exemplo.com"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-o2-coral px-4 py-2 text-sm font-medium text-o2-coral transition hover:bg-o2-coral hover:text-white"
            >
              Convidar
            </button>
          </form>
        </section>
      )}
      </main>
    </>
  );
}

type ImobiliariaRow = {
  nome?: string | null;
  cnpj?: string | null;
  creci?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  logo_url?: string | null;
  texto_base_contrato?: string | null;
  indice_reajuste?: string | null;
} | null | undefined;

function ChecklistCadastro({ imobiliaria }: { imobiliaria: ImobiliariaRow }) {
  const campos = [
    { label: "Nome da imobiliária", ok: !!imobiliaria?.nome },
    { label: "CNPJ", ok: !!imobiliaria?.cnpj },
    { label: "CRECI", ok: !!imobiliaria?.creci },
    { label: "Telefone de contato", ok: !!imobiliaria?.telefone },
    { label: "Endereço", ok: !!imobiliaria?.endereco },
    { label: "Logo", ok: !!imobiliaria?.logo_url },
    { label: "Contrato-base", ok: !!imobiliaria?.texto_base_contrato },
    { label: "Índice de reajuste", ok: !!imobiliaria?.indice_reajuste },
  ];
  const preenchidos = campos.filter((c) => c.ok).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <p className="mb-2 text-sm font-medium text-o2-navy">
        Campos preenchidos: {preenchidos}/{campos.length}
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {campos.map((c) => (
          <li
            key={c.label}
            className={`flex items-center gap-1.5 text-sm ${c.ok ? "text-green-700" : "text-gray-400"}`}
          >
            <span>{c.ok ? "✓" : "○"}</span>
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
