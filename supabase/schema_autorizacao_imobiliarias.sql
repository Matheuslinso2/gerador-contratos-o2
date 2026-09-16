-- Autorização comercial de imobiliárias (pedido do Matheus, 16/09/2026):
-- com as ferramentas mais visíveis (Auditor público, site da O2), criar
-- login deixou de significar acesso ilimitado automático. Conta nova usa
-- livremente por DIAS_GRACA_AUTORIZACAO dias (src/lib/autorizacaoImobiliaria.ts)
-- enquanto o Matheus analisa; depois disso, só as 3 ferramentas que chamam
-- IA (gerar-contrato, auditar-contrato, assistente-fianca) ficam limitadas
-- até ele autorizar em /admin/imobiliarias -- o resto do Workspace continua
-- acessível normalmente.

alter table imobiliarias add column if not exists autorizado boolean not null default false;
alter table imobiliarias add column if not exists autorizado_em timestamptz;
alter table imobiliarias add column if not exists responsavel text;

-- Grandfathering: confirmado que só existiam 2 logins no sistema inteiro
-- quando essa regra entrou (as 2 contas @o2seguros.com.br), então isso
-- autoriza automaticamente quem já tinha login antes desta mudança, sem
-- interrupção -- nenhuma imobiliária externa jamais tinha criado conta.
update imobiliarias set autorizado = true, autorizado_em = now() where user_id is not null;
