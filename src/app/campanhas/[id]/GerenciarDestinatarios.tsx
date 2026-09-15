"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SubmitButton from "@/components/SubmitButton";
import { ConfirmarDisparoButton } from "./ConfirmarDisparoButton";
import {
  alternarImobiliariaCampanha,
  alternarGrupoCampanha,
  removerContatoExternoCampanha,
  enviarTesteCampanha,
  confirmarDisparoCampanha,
  agendarDisparoCampanha,
} from "./actions";

// Só 2 telas no fluxo de criação de campanha (pedido do Matheus,
// 15/09/2026): criar + esta tela, que também é onde se gerencia quem
// recebe. Cada adicionar/excluir grava na hora via server action chamada
// direto (sem <form>, sem redirect) -- o estado selecionado nunca depende
// do que está filtrado no momento, então filtrar pra achar uma imobiliária
// não esconde nem arrisca perder quem já tinha sido adicionado antes
// (bug real da versão anterior, que só submetia os checkboxes visíveis no
// filtro atual). Prioridade é grupo (grupos pré-montados aparecem
// primeiro); adicionar imobiliária avulsa é só complemento.

type ImobLinha = { id: string; nome: string; emails: string[] };
type ContatoLinha = { id: string; nomeImobiliaria: string; nomeResponsavel: string | null; email: string };
type GrupoLinha = { id: string; nome: string; imobiliariaIds: string[]; contatos: ContatoLinha[] };

const botaoAdicionar = "rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white disabled:opacity-50";
const botaoRemover = "rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50";

export function GerenciarDestinatarios({
  campanhaId,
  imobiliarias,
  idsSelecionadosIniciais,
  grupos,
  contatosSelecionadosIniciais,
}: {
  campanhaId: string;
  imobiliarias: ImobLinha[];
  idsSelecionadosIniciais: string[];
  grupos: GrupoLinha[];
  contatosSelecionadosIniciais: ContatoLinha[];
}) {
  const router = useRouter();
  const [idsSelecionados, setIdsSelecionados] = useState<Set<string>>(new Set(idsSelecionadosIniciais));
  const [contatosSelecionados, setContatosSelecionados] = useState<ContatoLinha[]>(contatosSelecionadosIniciais);
  const [filtro, setFiltro] = useState("");
  const [idPendente, setIdPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Piso do <input datetime-local> -- 5 min à frente (mesma granularidade
  // do cron que dispara agendamentos, ver vercel.json). Calculado uma vez
  // só, não precisa ser exato ao segundo.
  const minAgendamento = useMemo(() => {
    const d = new Date(Date.now() + 5 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const imobiliariasPorId = useMemo(() => new Map(imobiliarias.map((i) => [i.id, i])), [imobiliarias]);
  const selecionadasLista = useMemo(
    () => [...idsSelecionados].map((id) => imobiliariasPorId.get(id)).filter((i): i is ImobLinha => !!i),
    [idsSelecionados, imobiliariasPorId]
  );

  const totalSelecionados = idsSelecionados.size + contatosSelecionados.length;
  const totalEmails = useMemo(() => {
    const set = new Set<string>();
    selecionadasLista.forEach((i) => i.emails.forEach((e) => set.add(e)));
    contatosSelecionados.forEach((c) => set.add(c.email.trim().toLowerCase()));
    return set.size;
  }, [selecionadasLista, contatosSelecionados]);

  const resultadosFiltro = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    if (!termo) return [];
    return imobiliarias.filter((i) => i.emails.length > 0 && i.nome.toLowerCase().includes(termo)).slice(0, 30);
  }, [filtro, imobiliarias]);

  async function executar(chave: string, acao: () => Promise<void>) {
    setErro(null);
    setIdPendente(chave);
    try {
      await acao();
      // Recarrega os dados dos Server Components da mesma página (sem
      // navegar, sem perder o estado local daqui) -- é o que faz a
      // "Produção gerada" logo abaixo já aparecer com a imobiliária/grupo
      // recém-adicionado, na hora (pedido do Matheus, 15/09/2026).
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao atualizar. Tente de novo.");
    } finally {
      setIdPendente(null);
    }
  }

  function alternarImob(id: string, incluir: boolean) {
    executar(id, async () => {
      await alternarImobiliariaCampanha(campanhaId, id, incluir);
      setIdsSelecionados((atual) => {
        const novo = new Set(atual);
        if (incluir) novo.add(id);
        else novo.delete(id);
        return novo;
      });
    });
  }

  function alternarGrupo(grupo: GrupoLinha, incluir: boolean) {
    executar(`grupo-${grupo.id}`, async () => {
      await alternarGrupoCampanha(
        campanhaId,
        grupo.imobiliariaIds,
        grupo.contatos.map((c) => c.id),
        incluir
      );
      setIdsSelecionados((atual) => {
        const novo = new Set(atual);
        grupo.imobiliariaIds.forEach((id) => (incluir ? novo.add(id) : novo.delete(id)));
        return novo;
      });
      setContatosSelecionados((atual) => {
        if (incluir) {
          const idsAtuais = new Set(atual.map((c) => c.id));
          return [...atual, ...grupo.contatos.filter((c) => !idsAtuais.has(c.id))];
        }
        const idsGrupo = new Set(grupo.contatos.map((c) => c.id));
        return atual.filter((c) => !idsGrupo.has(c.id));
      });
    });
  }

  function removerContato(contatoId: string) {
    executar(contatoId, async () => {
      await removerContatoExternoCampanha(campanhaId, contatoId);
      setContatosSelecionados((atual) => atual.filter((c) => c.id !== contatoId));
    });
  }

  return (
    <div className="space-y-4">
      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {totalSelecionados === 0 ? (
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Nenhum destinatário selecionado ainda. Adicione um grupo ou busque uma imobiliária abaixo.
        </p>
      ) : (
        <p className="text-xs text-gray-500">
          <strong>{totalSelecionados}</strong> destinatário(s) selecionado(s) · <strong>{totalEmails}</strong> e-mail(s) individuais
          vão receber esta campanha.
        </p>
      )}

      <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-o2-navy/10 bg-white shadow-sm">
        {selecionadasLista.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="truncate font-medium text-o2-navy">{i.nome}</span>
            <button type="button" disabled={idPendente === i.id} onClick={() => alternarImob(i.id, false)} className={botaoRemover}>
              {idPendente === i.id ? "..." : "Remover"}
            </button>
          </div>
        ))}
        {contatosSelecionados.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 truncate">
              <span className="font-medium text-o2-navy">{c.nomeImobiliaria}</span>
              {c.nomeResponsavel && <span className="ml-1 text-xs text-gray-500">(A/C: {c.nomeResponsavel})</span>}
              <span className="ml-2 text-xs text-gray-400">(prospecção)</span>
            </span>
            <button type="button" disabled={idPendente === c.id} onClick={() => removerContato(c.id)} className={botaoRemover}>
              {idPendente === c.id ? "..." : "Remover"}
            </button>
          </div>
        ))}
        {!totalSelecionados && <p className="px-4 py-6 text-center text-xs text-gray-400">Ninguém selecionado ainda.</p>}
      </div>

      {grupos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">Grupos</p>
          <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-o2-navy/10 bg-white shadow-sm">
            {grupos.map((g) => {
              const chave = `grupo-${g.id}`;
              const totalMembros = g.imobiliariaIds.length + g.contatos.length;
              return (
                <div key={g.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-o2-navy">{g.nome}</span>
                    <span className="ml-2 text-xs text-gray-400">{totalMembros} contato(s)</span>
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={idPendente === chave} onClick={() => alternarGrupo(g, true)} className={botaoAdicionar}>
                      {idPendente === chave ? "..." : "Adicionar grupo"}
                    </button>
                    <button type="button" disabled={idPendente === chave} onClick={() => alternarGrupo(g, false)} className={botaoRemover}>
                      {idPendente === chave ? "..." : "Excluir grupo"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600">Adicionar imobiliária individual (complemento)</label>
        <input
          type="text"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por nome..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
        />
        {filtro.trim() && (
          <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-o2-navy/10 bg-white shadow-sm">
            {resultadosFiltro.map((i) => {
              const jaSelecionada = idsSelecionados.has(i.id);
              return (
                <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="truncate">{i.nome}</span>
                  <button
                    type="button"
                    disabled={idPendente === i.id}
                    onClick={() => alternarImob(i.id, !jaSelecionada)}
                    className={jaSelecionada ? botaoRemover : botaoAdicionar}
                  >
                    {idPendente === i.id ? "..." : jaSelecionada ? "Excluir da campanha" : "Adicionar à campanha"}
                  </button>
                </div>
              );
            })}
            {!resultadosFiltro.length && <p className="px-4 py-6 text-center text-xs text-gray-400">Nenhuma imobiliária encontrada.</p>}
          </div>
        )}
      </div>

      {/* Item 9 da reunião de 15/09/2026: agendar disparo pra mais tarde
          em vez de mandar agora -- cancelável antes do envio (volta pra
          rascunho, ver seção "Agendamento" quando o status já virou
          "agendada"). */}
      <form action={agendarDisparoCampanha} className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-quadro p-3">
        <input type="hidden" name="campanha_id" value={campanhaId} />
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Ou agende o disparo pra depois</label>
          <input
            type="datetime-local"
            name="agendado_para"
            min={minAgendamento}
            required
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
          />
        </div>
        <SubmitButton
          className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
          textoCarregando="Agendando..."
        >
          Agendar disparo
        </SubmitButton>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
        <form action={enviarTesteCampanha}>
          <input type="hidden" name="campanha_id" value={campanhaId} />
          <SubmitButton
            className="rounded-full border border-o2-navy px-5 py-2 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
            textoCarregando="Enviando teste..."
          >
            Enviar e-mail de teste pra mim
          </SubmitButton>
        </form>

        <form action={confirmarDisparoCampanha}>
          <input type="hidden" name="campanha_id" value={campanhaId} />
          <ConfirmarDisparoButton
            className="rounded-full bg-o2-coral px-6 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            textoCarregando="Disparando..."
            mensagemConfirmacao={`Confirmar disparo pra ${totalEmails} e-mail(s)? Não dá pra desfazer depois de iniciado.`}
          >
            Confirmar e disparar
          </ConfirmarDisparoButton>
        </form>
      </div>
    </div>
  );
}
