import SubmitButton from "@/components/SubmitButton";
import { MOTIVOS_RECUSA, type ItemChecklist } from "@/lib/sinistros/regras";
import { analisarDocumento, registrarNoHistorico, removerDocumento } from "../actions";
import UploadDocumento from "./UploadDocumento";
import { inputClass, labelClass } from "../ui";

export type Documento = {
  id: string;
  tipo: string;
  nome_arquivo: string;
  situacao: string;
  motivo_recusa: string | null;
  enviado_em: string;
  url?: string | null;
};

const PILULA: Record<string, string> = {
  enviado: "bg-blue-100 text-blue-800",
  aprovado: "bg-green-100 text-green-800",
  recusado: "bg-red-100 text-red-700",
};
const ROTULO: Record<string, string> = { enviado: "enviado", aprovado: "aprovado", recusado: "recusado" };

// Checklist de documentos (R4) -- cada item com os arquivos já enviados.
// modo "imobiliaria": envia/remove; modo "o2": aprova/recusa cada arquivo.
export function ChecklistDocumentos({
  id,
  itens,
  documentos,
  modo,
  editavel,
  passo,
}: {
  id: string;
  itens: ItemChecklist[];
  documentos: Documento[];
  modo: "imobiliaria" | "o2";
  editavel: boolean;
  passo?: number;
}) {
  // Documento de um tipo que saiu do checklist (ex.: cobertura desmarcada)
  // continua visível em "Outros".
  const chaves = new Set(itens.map((i) => i.chave));
  const docsDe = (chave: string) =>
    documentos.filter((d) => d.tipo === chave || (chave === "outros" && !chaves.has(d.tipo)));

  return (
    <ul className="space-y-2">
      {itens.map((item) => {
        const docs = docsDe(item.chave);
        const ativo = docs.some((d) => d.situacao !== "recusado");
        const recusado = !ativo && docs.some((d) => d.situacao === "recusado");
        const marca = ativo ? "✓" : recusado ? "!" : item.obrigatorio ? "○" : "·";
        const corMarca = ativo ? "bg-green-600" : recusado ? "bg-red-600" : item.obrigatorio ? "bg-gray-300" : "bg-gray-200";
        return (
          <li key={item.chave} className={`rounded-xl border bg-white p-3 ${recusado ? "border-red-300" : "border-gray-200"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-2">
                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${corMarca}`}>{marca}</span>
                <div>
                  <p className="text-sm font-semibold text-o2-navy">
                    {item.titulo}
                    {!item.obrigatorio && <span className="ml-1 text-xs font-normal text-gray-400">(opcional)</span>}
                  </p>
                  {item.ajuda && <p className="text-xs text-gray-500">{item.ajuda}</p>}
                </div>
              </div>
              {editavel && modo === "imobiliaria" && <UploadDocumento id={id} tipo={item.chave} rotulo={docs.length ? "+ Arquivo" : "Enviar"} />}
            </div>
            {docs.length > 0 && (
              <ul className="mt-2 space-y-1.5 pl-7">
                {docs.map((d) => (
                  <li key={d.id} className="text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-o2-blue underline">
                          {d.nome_arquivo}
                        </a>
                      ) : (
                        <span className="font-medium">{d.nome_arquivo}</span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${PILULA[d.situacao] ?? ""}`}>{ROTULO[d.situacao] ?? d.situacao}</span>
                      {editavel && modo === "imobiliaria" && d.situacao === "enviado" && (
                        <form action={removerDocumento}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="documento_id" value={d.id} />
                          {passo && <input type="hidden" name="passo" value={passo} />}
                          <button className="text-red-600 hover:underline">remover</button>
                        </form>
                      )}
                    </div>
                    {d.situacao === "recusado" && d.motivo_recusa && <p className="mt-0.5 text-red-700">Motivo: {d.motivo_recusa}</p>}
                    {modo === "o2" && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {d.situacao !== "aprovado" && (
                          <form action={analisarDocumento}>
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="documento_id" value={d.id} />
                            <input type="hidden" name="decisao" value="aprovado" />
                            <button className="rounded-full bg-green-600 px-3 py-0.5 font-semibold text-white hover:opacity-90">Aprovar</button>
                          </form>
                        )}
                        {d.situacao !== "recusado" && (
                          <form action={analisarDocumento} className="flex flex-wrap items-center gap-1">
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="documento_id" value={d.id} />
                            <input type="hidden" name="decisao" value="recusado" />
                            <select name="motivo_lista" defaultValue="" className="rounded border border-gray-300 px-1 py-0.5">
                              <option value="">Motivo…</option>
                              {MOTIVOS_RECUSA.map((m) => (
                                <option key={m}>{m}</option>
                              ))}
                            </select>
                            <input name="motivo_texto" placeholder="detalhe (opcional)" className="w-40 rounded border border-gray-300 px-1 py-0.5" />
                            <button className="rounded-full bg-red-600 px-3 py-0.5 font-semibold text-white hover:opacity-90">Recusar</button>
                          </form>
                        )}
                        {d.situacao !== "enviado" && (
                          <form action={analisarDocumento}>
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="documento_id" value={d.id} />
                            <input type="hidden" name="decisao" value="desfazer" />
                            <button className="text-gray-500 hover:underline">desfazer</button>
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type RegistroHistorico = {
  id: string;
  criado_em: string;
  autor_email: string | null;
  autor_tipo: string;
  referente: string | null;
  texto: string;
  visivel_imobiliaria: boolean;
};

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

const AUTOR: Record<string, string> = { imobiliaria: "Imobiliária", o2: "O2", sistema: "Sistema" };

export function Historico({ id, registros, modo }: { id: string; registros: RegistroHistorico[]; modo: "imobiliaria" | "o2" }) {
  return (
    <div className="space-y-4">
      <form action={registrarNoHistorico} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <input type="hidden" name="id" value={id} />
        <label className={labelClass}>{modo === "o2" ? "Novo registro" : "Mandar mensagem para a O2"}</label>
        <textarea name="texto" rows={2} required className={inputClass} />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {modo === "o2" ? (
            <div className="flex flex-wrap items-center gap-3">
              <select name="referente" defaultValue="seguradora" className="rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="seguradora">Referente à seguradora</option>
                <option value="imobiliaria">Referente à imobiliária</option>
                <option value="locatario">Referente ao locatário</option>
                <option value="escritorio">Referente ao escritório</option>
                <option value="interno">Interno</option>
              </select>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="visivel_imobiliaria" className="accent-o2-coral" /> visível à imobiliária
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="enviar_email" className="accent-o2-coral" /> enviar e-mail à imobiliária
              </label>
            </div>
          ) : (
            <span className="text-xs text-gray-500">A equipe de sinistro da O2 recebe aqui.</span>
          )}
          <SubmitButton className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-semibold text-white" textoCarregando="Registrando…">
            Registrar
          </SubmitButton>
        </div>
      </form>
      {registros.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhum registro ainda.</p>
      ) : (
        <ol className="space-y-3 border-l-2 border-o2-coral pl-4">
          {registros.map((r) => (
            <li key={r.id} className="text-sm">
              <p className="text-xs text-gray-500">
                <b className="text-o2-navy">{dataHora(r.criado_em)}</b> · {AUTOR[r.autor_tipo] ?? r.autor_tipo}
                {modo === "o2" && r.autor_email ? ` (${r.autor_email})` : ""}
                {modo === "o2" && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 font-semibold ${r.visivel_imobiliaria ? "bg-blue-100 text-blue-800" : "bg-gray-200 text-gray-600"}`}>
                    {r.visivel_imobiliaria ? "visível à imobiliária" : "interno"}
                  </span>
                )}
              </p>
              <p className="whitespace-pre-wrap text-gray-800">{r.texto}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
