"use client";

// Mesmo padrão de src/app/campanhas/grupos/ExcluirGrupoButton.tsx --
// excluir funciona em qualquer status (pedido do Matheus, 15/09/2026),
// inclusive campanha já enviada -- perde o histórico de envios/produção
// junto, por isso o aviso é mais forte quando não é rascunho.
export function ExcluirCampanhaButton({ nomeCampanha, jaEnviada, className = "" }: { nomeCampanha: string; jaEnviada: boolean; className?: string }) {
  const aviso = jaEnviada
    ? `Excluir a campanha "${nomeCampanha}"? Ela já foi enviada -- isso apaga o histórico de envios, produção e métricas também. Não dá pra desfazer.`
    : `Excluir a campanha "${nomeCampanha}"? Não dá pra desfazer.`;

  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(aviso)) e.preventDefault();
      }}
    >
      Excluir
    </button>
  );
}
