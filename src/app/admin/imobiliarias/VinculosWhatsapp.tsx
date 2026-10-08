import { adicionarWhatsappImobiliaria, alterarWhatsappImobiliaria } from "./actions";
import { IconSend, IconTrash } from "@/components/icons";
import { SubmitButton } from "../../faturas/SubmitButton";

const inputClass = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none";

export type ContatoWhatsappImobiliaria = { id: string; nome: string; numero: string; ativo: boolean };

function fmtNumero(n: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(n);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : n;
}

// Mesmo padrão de VinculosFaturas/VinculosRepasse/VinculosCampanhas -- quarto
// canal da imobiliária. Quem estiver aqui conversa com o Workspace pelo
// WhatsApp e só enxerga os dados desta imobiliária (08/10/2026).
export default function VinculosWhatsapp({
  imobiliariaId,
  contatos,
  voltarPara,
}: {
  imobiliariaId: string;
  contatos: ContatoWhatsappImobiliaria[];
  voltarPara: string;
}) {
  return (
    <div className="rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-o2-navy/5 text-o2-navy">
          <IconSend className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-o2-navy">WhatsApp</h2>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Quem pode conversar com o Workspace pelo WhatsApp em nome desta imobiliária — só enxerga os dados dela. (Atendimento
        às imobiliárias em construção: por enquanto recebem uma resposta de &quot;em breve&quot;.)
      </p>

      {contatos.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {contatos.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5 ${c.ativo ? "" : "opacity-50"}`}
            >
              <span className="text-sm text-gray-800">
                {c.nome} · {fmtNumero(c.numero)}
                {!c.ativo && " · pausado"}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <form action={alterarWhatsappImobiliaria}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
                  <input type="hidden" name="voltar_para" value={voltarPara} />
                  <input type="hidden" name="acao" value={c.ativo ? "pausar" : "ativar"} />
                  <SubmitButton className="text-xs text-gray-500 hover:text-o2-navy hover:underline" textoCarregando="…">
                    {c.ativo ? "Pausar" : "Reativar"}
                  </SubmitButton>
                </form>
                <form action={alterarWhatsappImobiliaria}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
                  <input type="hidden" name="voltar_para" value={voltarPara} />
                  <input type="hidden" name="acao" value="remover" />
                  <SubmitButton
                    className="text-gray-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                    textoCarregando="…"
                    confirmarAntes={`Remover o WhatsApp de ${c.nome}?`}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <form action={adicionarWhatsappImobiliaria} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
        <input type="hidden" name="voltar_para" value={voltarPara} />
        <input name="nome" placeholder="Nome do contato" className={`${inputClass} max-w-[12rem]`} />
        <input name="numero" inputMode="numeric" placeholder="5521999990000" className={`${inputClass} max-w-[11rem]`} />
        <SubmitButton
          className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          textoCarregando="Adicionando..."
        >
          + Adicionar WhatsApp
        </SubmitButton>
      </form>
    </div>
  );
}
