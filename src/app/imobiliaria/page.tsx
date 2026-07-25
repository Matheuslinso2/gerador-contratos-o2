import { createClient } from "@/lib/supabase/server";
import { salvarImobiliaria } from "./actions";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

export default async function ImobiliariaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: imobiliaria } = await supabase
    .from("imobiliarias")
    .select("*")
    .eq("user_id", user!.id)
    .maybeSingle();

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

      {imobiliaria?.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imobiliaria.logo_url} alt="Logo" className="h-16 object-contain" />
      )}

      <form action={salvarImobiliaria} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            name="nome"
            placeholder="Nome da imobiliária"
            required
            defaultValue={imobiliaria?.nome}
            className="rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <input
            name="cnpj"
            placeholder="CNPJ"
            required
            defaultValue={imobiliaria?.cnpj}
            className="rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            name="creci"
            placeholder="CRECI"
            defaultValue={imobiliaria?.creci ?? ""}
            className="rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <input
            name="telefone"
            placeholder="Telefone de contato"
            defaultValue={imobiliaria?.telefone ?? ""}
            className="rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
        </div>
        <input
          name="endereco"
          placeholder="Endereço do escritório"
          defaultValue={imobiliaria?.endereco ?? ""}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />

        <div>
          <label className="text-sm text-gray-600">
            Logo da imobiliária (opcional, aparece no Word gerado)
          </label>
          <input name="logo" type="file" accept="image/*" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none" />
        </div>

        <div>
          <label className="text-sm text-gray-600">
            Enviar o contrato-base em Word (opcional — extrai o texto automaticamente e preenche o campo abaixo)
          </label>
          <input
            name="contrato_arquivo"
            type="file"
            accept=".docx"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Aceita apenas .docx. Se enviar um arquivo, ele substitui o texto digitado abaixo.
          </p>
        </div>

        <textarea
          name="texto_base_contrato"
          placeholder="Ou cole aqui o texto-base do contrato (comum a todas as locações)"
          rows={6}
          defaultValue={imobiliaria?.texto_base_contrato ?? ""}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />

        <div className="grid grid-cols-2 gap-2">
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

        <div className="grid grid-cols-4 gap-2">
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
          <div>
            <label className="text-sm text-gray-600">Dia vencimento aluguel</label>
            <input
              name="dia_vencimento_aluguel"
              type="number"
              min={1}
              max={31}
              required
              defaultValue={imobiliaria?.dia_vencimento_aluguel ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
        </div>

        <button
          className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
          type="submit"
        >
          Salvar imobiliária
        </button>
      </form>
      </main>
    </>
  );
}
