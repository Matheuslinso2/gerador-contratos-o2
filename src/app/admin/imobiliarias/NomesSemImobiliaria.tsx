import { ROTULO_FONTE, type RegistroFonte } from "@/lib/baseUnica/revisao";
import { ignorarRegistro, ligarRegistro } from "./fontesActions";

// Base Única (Fase 2): nomes que aparecem na produção (planilhas/Bitrix)
// sem nenhuma ficha candidata — maiores primeiro. Para cada um: ligar a uma
// ficha existente (escolhendo na lista) ou marcar "não é imobiliária".
// Imobiliária que ainda não tem ficha: criar em "+ Nova imobiliária" e
// depois ligar o nome pela seção "Fontes e vínculos" da ficha nova.
export default function NomesSemImobiliaria({
  nomes,
  total,
  fichas,
}: {
  nomes: RegistroFonte[];
  total: number;
  fichas: { id: string; nome: string; cnpj: string | null }[];
}) {
  if (total === 0) return null;
  const voltarPara = "/admin/imobiliarias";

  return (
    <details id="fontes" className="group rounded-xl border border-o2-navy/15 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Nomes sem imobiliária</span>
          <span className="ml-2 text-xs text-gray-500">
            {total} nome(s) da produção sem nenhuma ficha candidata — mostrando os {nomes.length} maiores
          </span>
        </span>
        <span className="text-xs text-gray-400 transition group-open:rotate-180">▾</span>
      </summary>

      <datalist id="lista-fichas">
        {fichas.map((f) => (
          <option key={f.id} value={`${f.nome}${f.cnpj ? ` · ${f.cnpj}` : ""} [${f.id}]`} />
        ))}
      </datalist>

      <div className="space-y-2 px-4 pb-4">
        {nomes.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="text-sm font-medium text-o2-navy">“{r.nome_original}”</p>
              <p className="text-gray-500">
                {ROTULO_FONTE[r.fonte] ?? r.fonte} · {r.volume.toLocaleString("pt-BR")} aparição(ões)
                {r.anos?.length ? ` · ${Math.min(...r.anos)}–${Math.max(...r.anos)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form action={ligarRegistro} className="flex items-center gap-1">
                <input type="hidden" name="registro_id" value={r.id} />
                <input type="hidden" name="metodo" value="manual" />
                <input type="hidden" name="voltar_para" value={voltarPara} />
                <input
                  name="ficha_escolhida"
                  list="lista-fichas"
                  required
                  placeholder="Digite e escolha a ficha…"
                  className="w-56 rounded border border-gray-300 px-2 py-1"
                />
                <button type="submit" className="rounded-full bg-o2-coral px-3 py-1 font-medium text-white hover:opacity-90">
                  Ligar
                </button>
              </form>
              <form action={ignorarRegistro}>
                <input type="hidden" name="registro_id" value={r.id} />
                <input type="hidden" name="voltar_para" value={voltarPara} />
                <button type="submit" className="font-medium text-red-600 hover:underline">Não é imobiliária</button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
