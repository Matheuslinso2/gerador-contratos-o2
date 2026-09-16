import { estaAutorizada, diasRestantesDeGraca } from "@/lib/autorizacaoImobiliaria";

// Gate compartilhado pelas 3 ferramentas que chamam IA (gerar-contrato,
// auditar-contrato, assistente-fianca) -- pedido do Matheus, 16/09/2026.
// Colaborador O2 (bypass=true) nunca é afetado. O resto do Workspace
// (painéis, faturas, cadastro da imobiliária etc.) nunca passa por aqui --
// só quem envolve esta ferramenta específica.
export default function AvisoAutorizacaoImobiliaria({
  imobiliaria,
  bypass,
  children,
}: {
  imobiliaria: { autorizado: boolean; created_at: string };
  bypass: boolean;
  children: React.ReactNode;
}) {
  if (bypass || imobiliaria.autorizado) return <>{children}</>;

  if (!estaAutorizada(imobiliaria)) {
    return (
      <div className="rounded-lg border border-yellow-400 bg-yellow-50 p-4 text-sm text-yellow-800">
        <p className="font-medium">Seu cadastro está em análise pela O2 Seguros.</p>
        <p className="mt-1">
          Assim que autorizarmos, esta ferramenta libera automaticamente — o resto do Workspace continua disponível
          normalmente.
        </p>
      </div>
    );
  }

  const dias = diasRestantesDeGraca(imobiliaria);
  return (
    <>
      <p className="mb-3 rounded-lg border border-o2-coral/30 bg-o2-coral/5 p-3 text-xs text-o2-navy">
        Acesso gratuito por mais {dias} {dias === 1 ? "dia" : "dias"} enquanto a O2 Seguros analisa seu cadastro.
      </p>
      {children}
    </>
  );
}
