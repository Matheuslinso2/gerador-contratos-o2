// Autorização comercial de imobiliárias (pedido do Matheus, 16/09/2026) --
// ver supabase/schema_autorizacao_imobiliarias.sql. Conta nova usa livremente
// por DIAS_GRACA_AUTORIZACAO dias enquanto o Matheus analisa o cadastro;
// depois disso, as ferramentas que chamam IA (gerar-contrato,
// auditar-contrato, assistente-fianca) ficam limitadas até ele autorizar em
// /admin/imobiliarias. O resto do Workspace nunca é afetado por isso.
export const DIAS_GRACA_AUTORIZACAO = 3;

type ImobiliariaAutorizavel = { autorizado: boolean; created_at: string };

function limiteDeGraca(imobiliaria: ImobiliariaAutorizavel): number {
  return new Date(imobiliaria.created_at).getTime() + DIAS_GRACA_AUTORIZACAO * 24 * 60 * 60 * 1000;
}

export function estaAutorizada(imobiliaria: ImobiliariaAutorizavel): boolean {
  return imobiliaria.autorizado || Date.now() < limiteDeGraca(imobiliaria);
}

// Só faz sentido chamar quando estaAutorizada() já deu true por causa do
// período de graça (não autorizado de verdade ainda) -- usado pro aviso
// leve "acesso gratuito por mais N dias" nas 3 ferramentas.
export function diasRestantesDeGraca(imobiliaria: ImobiliariaAutorizavel): number {
  return Math.max(0, Math.ceil((limiteDeGraca(imobiliaria) - Date.now()) / (24 * 60 * 60 * 1000)));
}
