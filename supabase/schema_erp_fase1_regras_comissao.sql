-- ERP O2 — Fase 1a: regra de pagamento de comissão por seguradora (25/10/2026)
--
-- Regra explicada pelo Matheus (24/10, noite):
--   * A seguradora paga a comissão da O2 de duas formas:
--       - ESGOTAMENTO: entrega a comissão inteira nas primeiras parcelas até zerar
--         (prêmio 1.000 em 4x de 250, comissão 30% = 300 → 250 na 1ª, 50 na 2ª, nada depois).
--         Vale só até um certo nº de parcelas (ex.: "até 6x sem juros").
--       - PROPORCIONAL: cada parcela traz a comissão na mesma proporção
--         (1.000 em 10x de 100 → 30 pra O2 em cada parcela).
--     Qual forma vale depende da seguradora (e do nº de parcelas).
--   * O REPASSE à imobiliária é SEMPRE proporcional à parcela, sobre a mesma base da
--     comissão, mesmo quando a O2 recebeu por esgotamento (melhora o caixa da O2).
--     Ex.: parcela 100 → 70 seguradora, 25 O2, 5 imobiliária.
--   * Calendário: cliente paga → seguradora recebe do banco → paga a O2 em ~3 a 5 dias
--     → repasse à imobiliária no MÊS SEGUINTE ao recebimento (dia 15, já em erp_parametros).
--   * O repasse mensal da imob é o acúmulo das parcelas de todos os seguros dela
--     recebidas no mês (um na 1ª parcela, outro na 5ª, outro na 10ª...).
--
-- A Fase 0 gerou TODA previsão de comissão como proporcional. Este arquivo:
--   1. acrescenta a regra no cadastro da seguradora;
--   2. cria erp_recalcular_comissoes(de, ate) que refaz a previsão parcela a parcela
--      conforme a regra, só para comissões ainda 'prevista' (nada recebido é tocado),
--      por fatia e com auditoria desligada (lição do incidente de 24/10).
--
-- Execução (por fatia, uma por vez):
--   select erp_recalcular_comissoes('2026-01-01','2027-12-31');
--   select erp_recalcular_comissoes('2025-01-01','2026-01-01');
--   select erp_recalcular_comissoes('2024-01-01','2025-01-01');

alter table erp_seguradoras
  add column if not exists regra_comissao text not null default 'proporcional'
    check (regra_comissao in ('proporcional','esgotamento')),
  add column if not exists esgotamento_ate_parcelas int,       -- null = esgotamento em qualquer nº de parcelas
  add column if not exists prazo_pagamento_dias int not null default 5,  -- dias após o vencimento da parcela p/ a seguradora pagar a O2
  add column if not exists regra_confirmada_em date,            -- quando alguém conferiu a regra (Corp/demonstrativo)
  add column if not exists regra_observacao text;

comment on column erp_seguradoras.regra_comissao is 'proporcional = comissão vem em cada parcela na mesma proporção; esgotamento = comissão inteira nas primeiras parcelas até zerar';
comment on column erp_seguradoras.esgotamento_ate_parcelas is 'esgotamento vale só até este nº de parcelas; acima disso vira proporcional. null = sempre';

insert into erp_parametros (chave, valor, descricao) values
  ('repasse_defasagem_meses', '1', 'Repasse à imobiliária sai no mês seguinte ao recebimento da comissão'),
  ('repasse_sempre_proporcional', 'true', 'Repasse é proporcional à parcela mesmo quando a O2 recebe por esgotamento')
on conflict (chave) do nothing;

-- Recalcula a previsão de comissão (erp_comissoes tipo=comissao, status=prevista) das
-- parcelas dos documentos com competência em [p_de, p_ate). Mantém o total da comissão
-- do documento; só muda a distribuição entre parcelas e a data prevista de recebimento.
create or replace function erp_recalcular_comissoes(p_de date, p_ate date)
returns table (documentos int, comissoes int)
language plpgsql security definer set search_path = public as $$
declare v_docs int; v_com int;
begin
  alter table erp_comissoes disable trigger erp_comissoes_aud;

  create temp table _doc on commit drop as
  select d.id, d.comissao_valor, d.premio_liquido, d.comissao_pct, d.qtd_parcelas,
         s.regra_comissao, s.esgotamento_ate_parcelas, s.prazo_pagamento_dias
  from erp_documentos d
  left join erp_seguradoras s on s.id = d.seguradora_id
  where d.competencia >= p_de and d.competencia < p_ate
    and coalesce(d.qtd_parcelas, 0) > 0 and d.comissao_valor <> 0
    -- só documentos cuja comissão ainda está toda prevista (nada recebido/baixado)
    and not exists (
      select 1 from erp_parcelas p join erp_comissoes c on c.parcela_id = p.id
      where p.documento_id = d.id and c.tipo = 'comissao' and c.status <> 'prevista');
  select count(*) into v_docs from _doc;

  delete from erp_comissoes c using erp_parcelas p
   where c.parcela_id = p.id and c.tipo = 'comissao' and c.status = 'prevista'
     and p.documento_id in (select id from _doc);

  insert into erp_comissoes (parcela_id, tipo, base, pct, valor_previsto, previsao_recebimento, status)
  select x.parcela_id, 'comissao', x.base, x.pct, x.valor, x.vencimento + coalesce(x.prazo, 5), 'prevista'
  from (
    select p.id as parcela_id, p.vencimento, o.prazo_pagamento_dias as prazo, o.comissao_pct as pct,
           round(o.premio_liquido / o.qtd_parcelas, 2) as base,
           case
             -- ESGOTAMENTO: comissão inteira nas primeiras parcelas, limitada ao valor da parcela
             when o.regra_comissao = 'esgotamento'
              and (o.esgotamento_ate_parcelas is null or o.qtd_parcelas <= o.esgotamento_ate_parcelas)
             then greatest(0, least(p.valor,
                    o.comissao_valor - coalesce(sum(p.valor) over (partition by p.documento_id order by p.n
                                                 rows between unbounded preceding and 1 preceding), 0)))
             -- PROPORCIONAL: mesma fração em todas as parcelas (centavos na 1ª)
             else round(o.comissao_valor / o.qtd_parcelas, 2)
                  + case when p.n = 1 then o.comissao_valor - round(o.comissao_valor / o.qtd_parcelas, 2) * o.qtd_parcelas else 0 end
           end as valor
    from erp_parcelas p join _doc o on o.id = p.documento_id
  ) x;
  get diagnostics v_com = row_count;

  -- esgotamento com comissão maior que a soma das parcelas (raro: comissão > prêmio total)
  -- fica com a sobra na última parcela, para o total do documento bater
  update erp_comissoes c set valor_previsto = c.valor_previsto + s.sobra
  from (
    select p.documento_id, (array_agg(p.id order by p.n desc))[1] as ultima_parcela_id,
           o.comissao_valor - sum(c2.valor_previsto) as sobra
    from erp_parcelas p join _doc o on o.id = p.documento_id
    join erp_comissoes c2 on c2.parcela_id = p.id and c2.tipo = 'comissao'
    group by p.documento_id, o.comissao_valor, o.qtd_parcelas
    having abs(o.comissao_valor - sum(c2.valor_previsto)) >= 0.01
  ) s
  where c.parcela_id = s.ultima_parcela_id and c.tipo = 'comissao';

  alter table erp_comissoes enable trigger erp_comissoes_aud;
  return query select v_docs, v_com;
end $$;

revoke all on function erp_recalcular_comissoes(date, date) from public;

-- Contagem de documentos do ano por seguradora (ordenação da tela /erp/seguradoras)
create or replace function erp_docs_por_seguradora_2026()
returns table (seguradora_id uuid, docs bigint)
language sql stable security invoker set search_path = public as $$
  select d.seguradora_id, count(*) from erp_documentos d
  where d.competencia >= date_trunc('year', current_date)::date and d.seguradora_id is not null
  group by d.seguradora_id
$$;
grant execute on function erp_docs_por_seguradora_2026() to authenticated;

-- ============================================================ 25/10 (tarde): regra é por SEGURADORA × PRODUTO
-- Conferência nos relatórios reais das seguradoras (Drive › relatórios de comissão, agosto/2026):
--   * Tokio   — Incêndio (RESI/EMPR/COND, parcelas 1/4 … 10/11) e Fiança ("ALUGUEL 4/29"): PROPORCIONAL;
--               Auto aparece como "COMISSÃO ANTECIPADA" (toda a comissão na 1ª parcela, limitada
--               ao valor da parcela): ESGOTAMENTO.
--   * Porto   — "45-COMISSÃO FRACIONADA", parcelas 1 a 9 com a taxa sobre a parcela: PROPORCIONAL.
--   * Yelum   — parcelas 3/4, 7/12, 1/4 com % sobre a parcela: PROPORCIONAL.
--   * Too     — Fiança parcelas 14, 16, 22 a 30%: PROPORCIONAL.
--   * Pottencial — Fiança parcelas 10, 20, 36, 58 a 30%: PROPORCIONAL (renovações antigas a 10%).
--   * Brasilcap — título pago na venda (1 parcela): indiferente.
-- Conclusão: Incêndio e Fiança são proporcionais em todas; esgotamento ("comissão antecipada")
-- vale para Auto (e provavelmente RE individual à vista). Por isso a regra sai do nível
-- "seguradora" e passa a "seguradora × produto", com a seguradora como padrão.

create table if not exists erp_comissao_regras (
  id uuid primary key default gen_random_uuid(),
  seguradora_id uuid references erp_seguradoras(id) on delete cascade,   -- null = todas
  produto text,                                                            -- erp_ramos.produto; null = todos
  ramo_id uuid references erp_ramos(id),                                   -- mais específico que produto; null = todos
  regra_comissao text not null default 'proporcional' check (regra_comissao in ('proporcional','esgotamento')),
  esgotamento_ate_parcelas int,
  prazo_pagamento_dias int,                                                -- null = usa o da seguradora
  confirmada_em date,
  fonte text,                                                              -- de onde veio a confirmação
  observacao text,
  created_at timestamptz not null default now(),
  unique (seguradora_id, produto, ramo_id)
);
alter table erp_comissao_regras enable row level security;
drop policy if exists erp_comissao_regras_o2 on erp_comissao_regras;
create policy erp_comissao_regras_o2 on erp_comissao_regras for all to authenticated
  using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

-- Regra efetiva de um documento: ramo > produto > seguradora (colunas de erp_seguradoras) > proporcional
create or replace function erp_regra_comissao_doc(p_seguradora_id uuid, p_ramo_id uuid)
returns table (regra_comissao text, esgotamento_ate_parcelas int, prazo_pagamento_dias int)
language sql stable set search_path = public as $$
  select coalesce(r.regra_comissao, s.regra_comissao), coalesce(r.esgotamento_ate_parcelas, s.esgotamento_ate_parcelas), coalesce(r.prazo_pagamento_dias, s.prazo_pagamento_dias, 5)
  from erp_seguradoras s
  left join erp_ramos rm on rm.id = p_ramo_id
  left join lateral (
    select * from erp_comissao_regras c
    where (c.seguradora_id = p_seguradora_id or c.seguradora_id is null)
      and (c.ramo_id = p_ramo_id or c.ramo_id is null)
      and (c.produto = rm.produto or c.produto is null)
    order by (c.seguradora_id is not null) desc, (c.ramo_id is not null) desc, (c.produto is not null) desc
    limit 1
  ) r on true
  where s.id = p_seguradora_id
  union all
  select 'proporcional', null, 5 where p_seguradora_id is null
$$;

-- Sementes confirmadas (25/10/2026)
insert into erp_comissao_regras (seguradora_id, produto, regra_comissao, confirmada_em, fonte)
select s.id, x.produto, x.regra, '2026-10-25', x.fonte
from (values
  ('TOKI','incendio','proporcional','Extrato do Corretor Tokio 18/08 e 20/08/2026 (parcelas 1/4…10/11, % sobre a parcela)'),
  ('TOKI','fianca','proporcional','Extrato Tokio 03/08/2026 (ALUGUEL 4/29 a 29%)'),
  ('TOKI','condominio','proporcional','Extrato Tokio 03/08/2026 (CONDOMINIO 5/6, 1/6)'),
  ('TOKI','automovel','esgotamento','Extrato Tokio 03/08/2026 (AUTO "COMISSÃO ANTECIPADA" 1/6 = comissão inteira na 1ª)'),
  ('PORT','incendio','proporcional','Analítico de pagamentos Porto 21/08/2026 (45-COMISSÃO FRACIONADA, parcelas 1 a 9)'),
  ('YELU','incendio','proporcional','Demonstrativo Yelum 20/08/2026 (3/4, 7/12, 1/4)'),
  ('TOO','fianca','proporcional','Demonstrativo Too 2026/40 de 20/08/2026 (parcelas 14, 16, 22 a 30%)'),
  ('POTT','fianca','proporcional','Demonstrativo Pottencial 175995 jun/2026 (parcelas 10 a 58, 30%)')
) as x(seg, produto, regra, fonte)
join erp_seguradoras s on s.abreviacao = x.seg
on conflict (seguradora_id, produto, ramo_id) do nothing;

update erp_seguradoras set regra_confirmada_em = '2026-10-25',
  regra_observacao = 'Regra por produto em erp_comissao_regras (conferida nos relatórios de agosto/2026)'
where abreviacao in ('TOKI','PORT','YELU','TOO','POTT');

-- erp_recalcular_comissoes passa a usar a regra efetiva por documento (erp_regra_comissao_doc)
create or replace function erp_recalcular_comissoes(p_de date, p_ate date)
returns table (documentos int, comissoes int)
language plpgsql security definer set search_path = public as $$
declare v_docs int; v_com int;
begin
  alter table erp_comissoes disable trigger erp_comissoes_aud;

  create temp table _doc on commit drop as
  select d.id, d.comissao_valor, d.premio_liquido, d.comissao_pct, d.qtd_parcelas,
         rg.regra_comissao, rg.esgotamento_ate_parcelas, rg.prazo_pagamento_dias
  from erp_documentos d
  left join lateral erp_regra_comissao_doc(d.seguradora_id, d.ramo_id) rg on true
  where d.competencia >= p_de and d.competencia < p_ate
    and coalesce(d.qtd_parcelas, 0) > 0 and d.comissao_valor <> 0
    and not exists (
      select 1 from erp_parcelas p join erp_comissoes c on c.parcela_id = p.id
      where p.documento_id = d.id and c.tipo = 'comissao' and c.status <> 'prevista');
  select count(*) into v_docs from _doc;

  delete from erp_comissoes c using erp_parcelas p
   where c.parcela_id = p.id and c.tipo = 'comissao' and c.status = 'prevista'
     and p.documento_id in (select id from _doc);

  insert into erp_comissoes (parcela_id, tipo, base, pct, valor_previsto, previsao_recebimento, status)
  select x.parcela_id, 'comissao', x.base, x.pct, x.valor, x.vencimento + coalesce(x.prazo, 5), 'prevista'
  from (
    select p.id as parcela_id, p.vencimento, o.prazo_pagamento_dias as prazo, o.comissao_pct as pct,
           round(o.premio_liquido / o.qtd_parcelas, 2) as base,
           case
             when o.regra_comissao = 'esgotamento'
              and (o.esgotamento_ate_parcelas is null or o.qtd_parcelas <= o.esgotamento_ate_parcelas)
             then greatest(0, least(p.valor,
                    o.comissao_valor - coalesce(sum(p.valor) over (partition by p.documento_id order by p.n
                                                 rows between unbounded preceding and 1 preceding), 0)))
             else round(o.comissao_valor / o.qtd_parcelas, 2)
                  + case when p.n = 1 then o.comissao_valor - round(o.comissao_valor / o.qtd_parcelas, 2) * o.qtd_parcelas else 0 end
           end as valor
    from erp_parcelas p join _doc o on o.id = p.documento_id
  ) x;
  get diagnostics v_com = row_count;

  update erp_comissoes c set valor_previsto = c.valor_previsto + s.sobra
  from (
    select p.documento_id, (array_agg(p.id order by p.n desc))[1] as ultima_parcela_id,
           o.comissao_valor - sum(c2.valor_previsto) as sobra
    from erp_parcelas p join _doc o on o.id = p.documento_id
    join erp_comissoes c2 on c2.parcela_id = p.id and c2.tipo = 'comissao'
    group by p.documento_id, o.comissao_valor, o.qtd_parcelas
    having abs(o.comissao_valor - sum(c2.valor_previsto)) >= 0.01
  ) s
  where c.parcela_id = s.ultima_parcela_id and c.tipo = 'comissao';

  alter table erp_comissoes enable trigger erp_comissoes_aud;
  return query select v_docs, v_com;
end $$;
