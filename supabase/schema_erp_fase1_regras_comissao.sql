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
