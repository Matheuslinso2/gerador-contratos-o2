-- Dados estatísticos O2 (Matheus, 03/11/2026): visão de mercado dos seguros da
-- carteira, na aba "Dados estatísticos O2" do Início do Workspace. Tabelas
-- prontas (retrato) para ler em <1 s; remontadas 1x por dia junto com as demais
-- analise_* (cron /api/cron/analise-precos). Mesmas regras de
-- schema_ficha_visita.sql: Fiança de contratação NOVA, 1 linha por caso (a
-- planilha repete o caso nos meses seguintes: fica o estado mais avançado),
-- aluguel entre R$ 300 e 40.000, carteira da O2 (não o mercado inteiro).
--  * analise_mercado_mes: série por mês da COTAÇÃO (entrada), desde 2020. Difere do
--    painel /seguro-fianca, que conta cada evento no mês em que aconteceu.
--  * analise_mercado_faixa: fechamento por faixa de aluguel, últimos 24 meses.
--  * analise_mercado_seguradora_ano: participação de cada seguradora nas fechadas.
-- Acesso: só colaborador O2 (is_colaborador_o2).
create table if not exists analise_mercado_mes (
  mes date primary key, cotacoes int not null, decididas int not null, fechadas int not null,
  recusadas int not null, perdidas int not null, aluguel_mediano numeric,
  atualizado_em timestamptz not null default now()
);
create table if not exists analise_mercado_faixa (
  faixa text primary key, ordem int not null, decididas int not null, fechadas int not null,
  recusadas int not null, perdidas int not null, atualizado_em timestamptz not null default now()
);
create table if not exists analise_mercado_seguradora_ano (
  ano int not null, seguradora text not null, apolices int not null, pct numeric not null,
  atualizado_em timestamptz not null default now(), primary key (ano, seguradora)
);
alter table analise_mercado_mes enable row level security;
alter table analise_mercado_faixa enable row level security;
alter table analise_mercado_seguradora_ano enable row level security;
do $$ declare t text; begin
  foreach t in array array['analise_mercado_mes','analise_mercado_faixa','analise_mercado_seguradora_ano'] loop
    execute format('drop policy if exists %I on %I', t||'_colab', t);
    execute format('create policy %I on %I for select to authenticated using (is_colaborador_o2())', t||'_colab', t);
  end loop;
end $$;

create or replace function atualizar_analise_mercado() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_k int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;

  create temp table _mc on commit drop as
  select distinct on (p.chave_caso) p.chave_caso, p.status_padrao, p.aluguel, p.premio, p.data_recebimento,
         case
           when upper(p.seguradora) ~ '^(POTT).*(TF|TAXA FIXA)' then 'Pottencial Taxa Fixa'
           when upper(p.seguradora) like 'POTT%' then 'Pottencial Tradicional'
           when upper(p.seguradora) like 'ESSENCIAL%' or upper(p.seguradora) like 'PORTO ESSENCIAL%' then 'Porto Essencial'
           when upper(p.seguradora) like 'PORTO%' then 'Porto Tradicional'
           when upper(p.seguradora) like 'TOKIO%' then 'Tokio'
           when upper(p.seguradora) like 'TOO%' then 'Too'
           when upper(p.seguradora) like 'LIBERTY%' then 'Liberty'
         end as seg
  from producao_resolvida p
  where p.produto = 'fianca' and p.tipo = 'novo' and p.fonte in ('planilha', 'bitrix')
    and p.aluguel between 300 and 40000
    and p.data_recebimento between date '2020-01-01' and current_date
  order by p.chave_caso,
           case p.status_padrao when 'Convertido' then 6 when 'Perdido' then 5 when 'Recusado' then 4 when 'Cancelado' then 3 when 'Aprovado' then 2 else 1 end desc,
           p.herdada asc;

  delete from analise_mercado_mes where true;
  insert into analise_mercado_mes (mes, cotacoes, decididas, fechadas, recusadas, perdidas, aluguel_mediano)
  select date_trunc('month', data_recebimento)::date, count(*),
         count(*) filter (where status_padrao in ('Convertido', 'Perdido', 'Recusado')),
         count(*) filter (where status_padrao = 'Convertido'), count(*) filter (where status_padrao = 'Recusado'),
         count(*) filter (where status_padrao = 'Perdido'), percentile_cont(0.5) within group (order by aluguel)
  from _mc group by 1;

  delete from analise_mercado_faixa where true;
  insert into analise_mercado_faixa (faixa, ordem, decididas, fechadas, recusadas, perdidas)
  select f.faixa, f.ordem, count(*), count(*) filter (where status_padrao = 'Convertido'),
         count(*) filter (where status_padrao = 'Recusado'), count(*) filter (where status_padrao = 'Perdido')
  from _mc c
  join lateral (select case when aluguel < 1000 then '< 1.000' when aluguel < 1500 then '1.000-1.499' when aluguel < 2000 then '1.500-1.999'
                            when aluguel < 3000 then '2.000-2.999' when aluguel < 5000 then '3.000-4.999' when aluguel < 8000 then '5.000-7.999' else '8.000+' end as faixa,
                       case when aluguel < 1000 then 1 when aluguel < 1500 then 2 when aluguel < 2000 then 3 when aluguel < 3000 then 4
                            when aluguel < 5000 then 5 when aluguel < 8000 then 6 else 7 end as ordem) f on true
  where c.status_padrao in ('Convertido', 'Perdido', 'Recusado') and c.data_recebimento >= current_date - interval '24 months'
  group by f.faixa, f.ordem;

  delete from analise_mercado_seguradora_ano where true;
  insert into analise_mercado_seguradora_ano (ano, seguradora, apolices, pct)
  select ano, seg, n, round(100.0 * n / sum(n) over (partition by ano), 1)
  from (select extract(year from data_recebimento)::int ano, seg, count(*) n from _mc where status_padrao = 'Convertido' and seg is not null group by 1, 2) z;

  select count(*) into v_n from analise_mercado_mes;
  return v_n;
end $$;
revoke all on function atualizar_analise_mercado() from public, anon;
grant execute on function atualizar_analise_mercado() to authenticated, service_role;
