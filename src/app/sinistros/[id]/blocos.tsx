import SubmitButton from "@/components/SubmitButton";
import { MOTIVOS_RECUSA, type ItemChecklist } from "@/lib/sinistros/regras";
import { analisarDocumento, registrarNoHistorico, removerDocumento } from "../actions";
import { reaproveitarDocumento } from "../operacao";
import { formatarData } from "@/lib/sinistros/regras";
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
  pasta?: string | null;
};

const PILULA: Record<string, string> = {
  enviado: "bg-blue-100 text-blue-800",
  aprovado: "bg-green-100 text-green-800",
  recusado: "bg-red-100 text-red-700",
};
const ROTULO: Record<string, string> = { enviado: "aguardando validação", aprovado: "aceito", recusado: "recusado" };

/// Documentos do sinistro em tabela -- especificação "Tela de abertura" (Etapa 3,
// 22/10/2026): Documentos | Visualização | Validação (aceite ou recusa) |
// Observação. Para a imobiliária, o recusado aparece em vermelho como
// "Pendente". modo "o2": aceita/recusa cada arquivo (e também anexa, quando
// editavel). "reaproveitaveis": documento que a mesma imobiliária já mandou
// noutro sinistro -- um clique e ele é copiado. "modelos": modelo de
// Declaração de Débitos da seguradora do caso.
export function ChecklistDocumentos({
  id,
  itens,
  documentos,
  modo,
  editavel,
  passo,
  reaproveitaveis,
  modelos,
}: {
  id: string;
  itens: ItemChecklist[];
  documentos: Documento[];
  modo: "imobiliaria" | "o2";
  editavel: boolean;
  passo?: number;
  reaproveitaveis?: Record<string, { id: string; nome_arquivo: string; enviado_em: string; codigo?: number }>;
  modelos?: { rotulo: string; href: string }[];
}) {
  // Documento de um tipo que saiu do checklist (ex.: cobertura desmarcada)
  // continua visível em "Outros".
  const chaves = new Set(itens.map((i) => i.chave));
  const docsDe = (chave: string) =>
    documentos.filter((d) => d.tipo === chave || (chave === "outros" && !chaves.has(d.tipo)));
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-o2-navy";

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className={`${th} w-[34%]`}>Documentos</th>
            <th className={th}>Visualização</th>
            <th className={th}>Validação</th>
            <th className={th}>Observação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {itens.map((item) => {
            const docs = docsDe(item.chave);
            const linhas = docs.length ? docs : [null];
            const ativo = docs.some((d) => d.situacao !== "recusado");
            const pendente = !ativo && docs.some((d) => d.situacao === "recusado");
            return linhas.map((d, i) => (
              <tr key={`${item.chave}-${d?.id ?? "vazio"}`} className={pendente ? "bg-red-50" : ""}>
                {i === 0 && (
                  <td rowSpan={linhas.length} className="px-3 py-2 align-top">
                    <p className={`font-semibold ${pendente ? "text-red-700" : "text-o2-navy"}`}>
                      {item.titulo}
                      {!item.obrigatorio && <span className="ml-1 text-xs font-normal text-gray-400">(opcional)</span>}
                    </p>
                    {item.ajuda && <p className="text-xs text-gray-500">{item.ajuda}</p>}
                    {item.chave === "declaracao_debitos" && (
                      <div className="mt-1 space-y-1 text-xs">
                        {modelos && modelos.length > 0 ? (
                          modelos.map((m) => (
                            <a key={m.href} href={m.href} target="_blank" rel="noreferrer" className="block font-semibold text-o2-blue underline">
                              ⬇ {m.rotulo}
                            </a>
                          ))
                        ) : (
                          <p className="text-gray-600">Modelo desta seguradora: peça à O2 (sinistro@o2seguros.com.br).</p>
                        )}
                        <p className="rounded bg-red-100 px-2 py-1 font-semibold text-red-800">
                          A declaração só vale se estiver ASSINADA. Envie o documento assinado.
                        </p>
                      </div>
                    )}
                    {editavel && (
                      <div className="mt-2">
                        <UploadDocumento id={id} tipo={item.chave} rotulo={docs.length ? "+ Arquivo" : "Enviar"} />
                      </div>
                    )}
                    {editavel && !ativo && reaproveitaveis?.[item.chave] && (
                      <form action={reaproveitarDocumento} className="mt-2 text-xs">
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="documento_id" value={reaproveitaveis[item.chave].id} />
                        {passo && <input type="hidden" name="passo" value={passo} />}
                        <button className="rounded-full border border-o2-blue px-3 py-0.5 font-semibold text-o2-blue hover:bg-blue-50">
                          ↺ Usar o arquivo já enviado
                        </button>
                        <span className="ml-2 text-gray-500">
                          {reaproveitaveis[item.chave].nome_arquivo}
                          {reaproveitaveis[item.chave].codigo ? ` · SIN-${reaproveitaveis[item.chave].codigo}` : ""} ·{" "}
                          {formatarData(reaproveitaveis[item.chave].enviado_em.slice(0, 10))}
                        </span>
                      </form>
                    )}
                  </td>
                )}
                <td className="px-3 py-2 align-top text-xs">
                  {!d ? (
                    <span className="text-gray-400">{item.obrigatorio ? "não enviado" : "—"}</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-o2-blue underline">
                          {d.nome_arquivo}
                        </a>
                      ) : (
                        <span className="font-medium">{d.nome_arquivo}</span>
                      )}
                      {editavel && d.situacao === "enviado" && (
                        <form action={removerDocumento}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="documento_id" value={d.id} />
                          {passo && <input type="hidden" name="passo" value={passo} />}
                          <button className="text-red-600 hover:underline">remover</button>
                        </form>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  {d && (
                    <>
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${PILULA[d.situacao] ?? ""}`}>
                        {modo === "imobiliaria" && d.situacao === "recusado" ? "Pendente" : ROTULO[d.situacao] ?? d.situacao}
                      </span>
                      {modo === "o2" && (
                        <div className="mt-1 flex flex-col gap-1">
                          {d.situacao !== "aprovado" && (
                            <form action={analisarDocumento} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="id" value={id} />
                              <input type="hidden" name="documento_id" value={d.id} />
                              <input type="hidden" name="decisao" value="aprovado" />
                              <input name="observacao" placeholder="observação (opcional)" className="w-36 rounded border border-gray-300 px-1 py-0.5" />
                              <button className="rounded-full bg-green-600 px-3 py-0.5 font-semibold text-white hover:opacity-90">Aceitar</button>
                            </form>
                          )}
                          {d.situacao !== "recusado" && (
                            <form action={analisarDocumento} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="id" value={id} />
                              <input type="hidden" name="documento_id" value={d.id} />
                              <input type="hidden" name="decisao" value="recusado" />
                              <select name="motivo_lista" defaultValue="" className="w-36 rounded border border-gray-300 px-1 py-0.5">
                                <option value="">Motivo…</option>
                                {MOTIVOS_RECUSA.map((m) => (
                                  <option key={m}>{m}</option>
                                ))}
                              </select>
                              <input name="motivo_texto" placeholder="detalhe (opcional)" className="w-36 rounded border border-gray-300 px-1 py-0.5" />
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
                    </>
                  )}
                </td>
                <td className={`px-3 py-2 align-top text-xs ${d?.situacao === "recusado" ? "font-semibold text-red-700" : "text-gray-700"}`}>
                  {d?.motivo_recusa ?? ""}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
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
  data_evento?: string | null;
  editado_em?: string | null;
  editado_por?: string | null;
};

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

const AUTOR: Record<string, string> = { imobiliaria: "Imobiliária", o2: "O2", sistema: "Sistema" };
const COR_AUTOR: Record<string, string> = { imobiliaria: "bg-orange-100 text-orange-800", o2: "bg-blue-100 text-blue-800", sistema: "bg-gray-100 text-gray-600" };

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
        <ol className="max-h-[32rem] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 bg-white">
          {registros.map((r) => {
            const longo = r.texto.length > 240;
            return (
              <li key={r.id} className="px-3 py-2 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${COR_AUTOR[r.autor_tipo] ?? "bg-gray-100 text-gray-600"}`}>{AUTOR[r.autor_tipo] ?? r.autor_tipo}</span>
                  <span>{dataHora(r.criado_em)}</span>
                  {modo === "o2" && r.autor_email && <span>{r.autor_email}</span>}
                  {modo === "o2" && !r.visivel_imobiliaria && <span className="text-gray-400">· interno</span>}
                </p>
                {longo ? (
                  <details className="mt-0.5">
                    <summary className="cursor-pointer list-none text-gray-800">
                      {r.texto.slice(0, 240).trimEnd()}… <span className="text-xs text-o2-blue">ver tudo</span>
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-gray-800">{r.texto}</p>
                  </details>
                ) : (
                  <p className="mt-0.5 whitespace-pre-wrap text-gray-800">{r.texto}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
