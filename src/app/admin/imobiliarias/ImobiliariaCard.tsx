"use client";

import Link from "next/link";
import { excluirImobiliariaAdmin } from "./actions";

export type ImobiliariaAdminRow = {
  id: string;
  nome: string;
  cnpj: string | null;
  creci: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  indice_reajuste: string | null;
  plataforma_assinatura: string | null;
  created_at: string;
  cadastro_incompleto: boolean | null;
  contratos: number;
  auditorias: number;
  faturasEsperadas: number;
  membros: number;
};

// Resumo + link pra tela unificada (/admin/imobiliarias/[id]), onde de
// fato se edita tudo (dados, contrato-base, faturas, funcionários) --
// aqui na lista só fica o essencial pra escanear rápido, mais o atalho de
// excluir esqueletos vazios sem precisar entrar em cada um.
export default function ImobiliariaCard({ imobiliaria: i }: { imobiliaria: ImobiliariaAdminRow }) {
  const semDadosLigados = i.contratos + i.auditorias + i.faturasEsperadas + i.membros === 0;

  return (
    <div className="rounded-xl border border-o2-navy/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/admin/imobiliarias/${i.id}`} className="font-medium text-o2-navy hover:underline">
          {i.nome}
        </Link>
        {i.cadastro_incompleto && (
          <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
            cadastro incompleto
          </span>
        )}
      </div>
      <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-sm text-gray-600 sm:grid-cols-2">
        <p>CNPJ: {i.cnpj || "não informado"}</p>
        <p>E-mail de login: {i.email || "sem login próprio"}</p>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Cadastrada em {new Date(i.created_at).toLocaleString("pt-BR")} · {i.contratos} contrato(s) · {i.auditorias}{" "}
        auditoria(s) · {i.faturasEsperadas} vínculo(s) de fatura · {i.membros} membro(s)
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Link href={`/admin/imobiliarias/${i.id}`} className="text-xs font-medium text-o2-coral hover:underline">
          Gerenciar →
        </Link>
        {semDadosLigados && (
          <form
            action={excluirImobiliariaAdmin}
            onSubmit={(e) => {
              if (!confirm(`Excluir "${i.nome}" definitivamente? Não tem contrato/auditoria/fatura vinculado.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={i.id} />
            <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
              Excluir
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
