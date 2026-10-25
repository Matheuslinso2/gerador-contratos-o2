import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import ErpNav from "./ErpNav";

// ERP O2: aplicativo à parte do Workspace, do mesmo grupo (Matheus, 25/10/2026). Cabeçalho, menu e
// tela inicial próprios; nenhuma tela do ERP aparece nos menus do Workspace (lá só há o botão "ERP O2").
// Só equipe interna. Os dados continuam no mesmo banco (base única de imobiliárias, Corp, Bitrix).
//
// PREMISSAS DE TODA TELA DO ERP (as mesmas do Workspace — Matheus, 25/10/2026):
//  1. Velocidade: a tela lê TABELA PRONTA ou consulta por índice; nunca varre o banco inteiro na hora (view pesada
//     vira *_pronto refeita por cron/robô, com "gerado_em" na tela). Contagem exata só com filtro. Meta: < 1 s.
//     Mês fechado congela (só o mês aberto é recalculado). Funções na região gru1 (vercel.json).
//  2. Carregamento: src/app/erp/loading.tsx mostra o esqueleto na hora do clique, dentro do cabeçalho do ERP.
//  3. Atualização de versão: AvisoNovaVersao (layout raiz) troca de versão em silêncio no próximo clique;
//     todo formulário em que se digita tem <RascunhoAutomatico /> como 1º filho (o que foi digitado volta se a
//     versão mudar no meio do preenchimento). Não há Skew Protection no plano da Vercel.
//  4. Navegação: tela nova entra no ErpNav; nada do ERP nos menus do Workspace.
//  5. Filtros padronizados: toda tela usa <FiltrosErp> (src/app/erp/FiltrosErp.tsx + src/lib/erp/filtros.ts) com os
//     níveis hierárquicos que fazem sentido para ela (seguradora, corretora, produto, imobiliária/fatura, situação,
//     tipo, forma de pagamento, canal, período/mês, busca do item). Mesmo nome de parâmetro na URL em todas as telas.
export const metadata: Metadata = {
  title: { default: "ERP O2", template: "%s · ERP O2" },
  description: "Sistema de gestão da O2 Seguros: documentos, comissões, baixas, faturas e repasses",
};

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/erp");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-o2-gray">
      <header className="bg-o2-navy print:hidden">
        <div className="h-1 bg-o2-coral" />
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-6 py-3">
          <Link href="/erp" className="flex items-center gap-3">
            <Image src="/o2-logo-navy.png" alt="O2 Seguros" width={84} height={50} priority />
            <div className="border-l border-white/20 pl-3">
              <p className="text-base font-semibold text-white">
                ERP <span className="text-o2-coral">O2</span>
              </p>
              <p className="text-xs text-white/50">Sistema de gestão</p>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="rounded-full border border-white/30 px-3 py-1 text-xs font-medium text-white/80 hover:border-white hover:text-white"
              title="Abrir o Workspace O2"
            >
              Ir para o Workspace ↗
            </Link>
            <form action={signOut}>
              <button type="submit" className="text-xs text-white/60 hover:text-white hover:underline">
                {user.email} · Sair
              </button>
            </form>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto max-w-[1200px] px-6">
            <ErpNav />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
