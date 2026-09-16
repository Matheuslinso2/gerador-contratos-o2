"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { PRODUTOS_CAMPANHA } from "@/lib/campanhas/produtos";
import { EditorCorpo } from "../EditorCorpo";
import { editarConteudoCampanha } from "./actions";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

export type CampanhaParaEditar = {
  id: string;
  nome: string;
  assunto: string;
  template: string;
  titulo: string;
  introducao: string | null;
  valido_de: string | null;
  valido_ate: string | null;
  produto: string;
  corpo_html: string;
  cta_texto: string | null;
  cta_href: string | null;
};

// Pedido do Matheus, 17/09/2026: "após a criação da campanha e antes do
// envio deverá ser possível editar ainda o conteudo e campos do email" --
// só aparece em rascunho (jaEnviadaOuEnviando/agendada continuam com a
// prévia somente-leitura de sempre). Alterna entre a prévia e o formulário
// de edição sem sair da tela (mesmo padrão de "só 2 telas" já usado em
// GerenciarDestinatarios).
export function EditarConteudoCampanha({
  campanha,
  htmlEmail,
  rascunho,
  tituloSecao,
}: {
  campanha: CampanhaParaEditar;
  htmlEmail: string;
  rascunho: boolean;
  tituloSecao: string;
}) {
  const [editando, setEditando] = useState(false);

  if (!rascunho || !editando) {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-o2-navy">{tituloSecao}</h2>
          {rascunho && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="whitespace-nowrap rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
            >
              Editar conteúdo
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
          <p className="border-b border-o2-navy/10 bg-quadro px-4 py-2 text-xs font-medium uppercase tracking-wide text-o2-navy">Assunto: {campanha.assunto}</p>
          <div className="max-h-[480px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: htmlEmail }} />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-o2-navy">Editar conteúdo da campanha</h2>
        <button
          type="button"
          onClick={() => setEditando(false)}
          className="whitespace-nowrap rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-gray-400"
        >
          Cancelar edição
        </button>
      </div>

      <form action={editarConteudoCampanha} className="space-y-4 rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
        <input type="hidden" name="campanha_id" value={campanha.id} />

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Nome interno da campanha</label>
          <input name="nome" required defaultValue={campanha.nome} className={inputClass} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Válido de (opcional)</label>
            <input name="valido_de" type="date" defaultValue={campanha.valido_de ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Válido até (opcional)</label>
            <input name="valido_ate" type="date" defaultValue={campanha.valido_ate ?? ""} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Produto</label>
          <select name="produto" required defaultValue={campanha.produto} className={inputClass}>
            {PRODUTOS_CAMPANHA.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Modelo</label>
          <select name="template" defaultValue={campanha.template} className={inputClass}>
            <option value="comunicado">Comunicado geral</option>
            <option value="promocao">Promoção / oferta</option>
            <option value="newsletter">Newsletter</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Assunto do e-mail</label>
          <input name="assunto" required defaultValue={campanha.assunto} className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Título (destaque dentro do e-mail)</label>
          <input name="titulo" required defaultValue={campanha.titulo} className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Introdução (opcional)</label>
          <input name="introducao" defaultValue={campanha.introducao ?? ""} className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Corpo do e-mail</label>
          <EditorCorpo name="corpo_html" corpoInicialHtml={campanha.corpo_html} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Texto do botão (opcional)</label>
            <input name="cta_texto" defaultValue={campanha.cta_texto ?? ""} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Link do botão (opcional)</label>
            <input name="cta_href" type="url" defaultValue={campanha.cta_href ?? ""} className={inputClass} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <SubmitButton
            className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
            textoCarregando="Salvando..."
          >
            Salvar alterações
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
