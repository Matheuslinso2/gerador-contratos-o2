// Cookie liberado só por quem abre /acesso/<token> com o token certo (ver
// src/app/acesso/[token]/route.ts) -- pedido do Matheus, 18/09/2026: Auditor
// de Contrato e Multa Rescisória não ficam abertas no site principal pra
// qualquer visitante, só pra quem recebeu esse link específico.
export const NOME_COOKIE_ACESSO_PUBLICO = "o2_acesso_publico";

// Rotas que só ficam públicas (sem login) pra quem já tem o cookie --
// qualquer outra pessoa sem login cai no /login normal, igual o resto do
// Workspace. Ver src/proxy.ts.
export const ROTAS_PUBLICAS_COM_COOKIE = ["/auditar-contrato", "/multa-rescisoria"];
