-- ERP O2 — Fase 1b: forma de pagamento ESCOLHIDA na efetivação (25/10/2026)
-- Matheus: "ao efetivar uma proposta nós escolhemos a forma de pagamento, essa informação é sabida".
-- Dois controles distintos:
--   (1) efetivado em alguma forma de pagamento → aparece nas cobranças e nos filtros (modo_cobranca);
--   (2) escolheu FATURA, efetivou em fatura e não entrou na fatura nem em outra forma → alerta
--       (view erp_alertas_fatura só olha modo_cobranca in ('fatura','nao_informado')).
-- "Não administrado" deixa de ser deduzido pela ausência na fatura: passa a ser deduzido pela
-- escolha de boleto/cartão/débito quando a imobiliária tem fatura ativa na seguradora.
-- Aplicada via MCP apply_migration em 25/10/2026 (erp_fase1b_forma_pagamento_escolhida).

alter table erp_documentos drop constraint if exists erp_documentos_modo_cobranca_check;
alter table erp_documentos add constraint erp_documentos_modo_cobranca_check
  check (modo_cobranca in ('nao_informado','fatura','boleto','cartao','debito','individual'));
alter table erp_documentos alter column modo_cobranca set default 'nao_informado';
comment on column erp_documentos.modo_cobranca is 'Forma de pagamento escolhida na efetivação: fatura (da imobiliária) · boleto · cartao · debito; individual = legado sem detalhe; nao_informado = ainda não escolhida/importada';

-- legado: 'individual' era só o padrão, não uma escolha conhecida
update erp_documentos set modo_cobranca = 'nao_informado' where origem in ('corp_import','bitrix') and modo_cobranca = 'individual';
-- Capitalização: o card traz "Forma de pagamento" (Cartão/Boleto)
update erp_documentos d set modo_cobranca = case when o.dados_legiveis->>'Forma de pagamento' ilike 'cart%' then 'cartao' when o.dados_legiveis->>'Forma de pagamento' ilike 'bolet%' then 'boleto' else d.modo_cobranca end
from erp_origens o where o.documento_id = d.id and o.entity_type_id = 1048 and coalesce(o.dados_legiveis->>'Forma de pagamento','') <> '';

-- view erp_alertas_fatura: igual à v3 (schema_erp_fase1_alertas_fatura.sql) + filtro
--   and d.modo_cobranca in ('fatura','nao_informado')
-- (quem escolheu boleto/cartão/débito não é candidato a "fora da fatura")

create or replace function erp_inferir_administrado() returns table (marcados_sim int, marcados_nao int)
language plpgsql security definer set search_path = public as $$
declare v_s int; v_n int;
begin
  update erp_documento_itens it set administrado = true, administrado_fonte = 'inferido_fatura'
  from erp_documentos d join erp_alertas_fatura_pronto a on a.documento_id = d.id
  where d.id = it.documento_id and it.item_n = 1 and it.administrado is null and (a.alerta = 'ok' or d.modo_cobranca = 'fatura');
  get diagnostics v_s = row_count;
  update erp_documento_itens it set administrado = false, administrado_fonte = 'inferido_fatura'
  from erp_documentos d
  join erp_seguradoras s on s.id = d.seguradora_id
  join erp_ramos r on r.id = d.ramo_id
  where d.id = it.documento_id and it.item_n = 1 and it.administrado is null
    and d.modo_cobranca in ('boleto','cartao','debito') and r.produto in ('fianca','incendio','capitalizacao')
    and exists (select 1 from faturas_esperadas fe where fe.imobiliaria_id = d.imobiliaria_principal_id and fe.ativo
                and fe.seguradora = case s.abreviacao when 'TOKI' then 'TOKIO' when 'POTT' then 'POTTENCIAL' when 'TOO' then 'TOO' when 'YELU' then 'YELUM' when 'PORT' then 'PORTO FIANÇA' else s.abreviacao end);
  get diagnostics v_n = row_count;
  return query select v_s, v_n;
end $$;


-- ---------------------------------------------------------------------------
-- 25/10 (mesmo dia): cruzar as últimas faturas de cada imob × seguradora
-- (Matheus: "se você cruzar as últimas 2 ou 3 faturas de cada imob e seguradora
--  você vai conseguir cruzar quem é e quem não é da fatura").
-- Aplicado via MCP: erp_fase1b_cruzar_faturas_carregadas + _v2.
create table if not exists erp_fatura_apolices_observadas (
  documento_id uuid not null references erp_documentos(id) on delete cascade,
  fatura_id uuid not null references faturas(id) on delete cascade,
  seguradora text not null,
  vencimento date,
  competencia text,
  observado_em timestamptz not null default now(),
  primary key (documento_id, fatura_id)
);
alter table erp_fatura_apolices_observadas enable row level security;
create policy colab_all on erp_fatura_apolices_observadas for all to authenticated using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));
create index if not exists erp_fatura_apolices_obs_fatura_idx on erp_fatura_apolices_observadas(fatura_id);

-- erp_cruzar_faturas_carregadas(): para cada relatório de fatura carregado (Tokio/Pottencial/Too/Yelum;
-- Too não tem vencimento → último dia da competência), grava em erp_fatura_apolices_observadas
-- toda apólice do ERP (mesma imob × seguradora) cujo número aparece no texto; quem apareceu vira
-- modo_cobranca = 'fatura' (sem sobrescrever escolha explícita) e administrado = true (inferido_fatura).
-- Encadeada no cron /api/cron/erp-bitrix?spa=1042 (1× por hora) antes dos alertas.
-- erp_fora_das_ultimas_faturas (view): apólices vigentes de fiança/incêndio/condomínio com parcela
-- vencendo na janela das faturas carregadas (imob com 2+ relatórios) que não apareceram em nenhuma →
-- candidatas a boleto/cartão; confirmar no extrato de comissão (Fase 2). Listada em /erp/conferencia.
