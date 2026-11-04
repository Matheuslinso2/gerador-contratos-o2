-- Fechamento por faixa de aluguel por MÊS (Matheus, 04/11/2026): permite o filtro de
-- período (12 meses, 24 meses, tudo) na aba "Dados estatísticos O2" do Início.
-- Mesma base e mesmas regras de schema_mercado_estatisticas.sql (Fiança de contratação
-- nova, 1 linha por caso, aluguel R$ 300 a 40.000, coorte pelo mês de ENTRADA da
-- cotação). Acesso: só colaborador O2.
create table if not exists analise_mercado_mes_faixa (
  mes date not null, faixa text not null, ordem int not null,
  decididas int not null, fechadas int not null, recusadas int not null, perdidas int not null,
  atualizado_em timestamptz not null default now(),
  primary key (mes, faixa)
);
alter table analise_mercado_mes_faixa enable row level security;
drop policy if exists analise_mercado_mes_faixa_colab on analise_mercado_mes_faixa;
create policy analise_mercado_mes_faixa_colab on analise_mercado_mes_faixa for select to authenticated using (is_colaborador_o2());

create or replace function atualizar_analise_mercado_faixa() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  delete from analise_mercado_mes_faixa where true;
  insert into analise_mercado_mes_faixa (mes, faixa, ordem, decididas, fechadas, recusadas, perdidas)
  with c as (
    select distinct on (p.chave_caso) p.status_padrao, p.aluguel, p.data_recebimento
    from producao_resolvida p
    where p.produto = 'fianca' and p.tipo = 'novo' and p.fonte in ('planilha', 'bitrix')
      and p.aluguel between 300 and 40000 and p.data_recebimento between date '2020-01-01' and current_date
    order by p.chave_caso,
             case p.status_padrao when 'Convertido' then 6 when 'Perdido' then 5 when 'Recusado' then 4 when 'Cancelado' then 3 when 'Aprovado' then 2 else 1 end desc,
             p.herdada asc
  )
  select date_trunc('month', c.data_recebimento)::date, f.faixa, f.ordem, count(*),
         count(*) filter (where status_padrao = 'Convertido'), count(*) filter (where status_padrao = 'Recusado'),
         count(*) filter (where status_padrao = 'Perdido')
  from c
  join lateral (select case when aluguel < 1000 then '< 1.000' when aluguel < 1500 then '1.000-1.499' when aluguel < 2000 then '1.500-1.999'
                            when aluguel < 3000 then '2.000-2.999' when aluguel < 5000 then '3.000-4.999' when aluguel < 8000 then '5.000-7.999' else '8.000+' end as faixa,
                       case when aluguel < 1000 then 1 when aluguel < 1500 then 2 when aluguel < 2000 then 3 when aluguel < 3000 then 4
                            when aluguel < 5000 then 5 when aluguel < 8000 then 6 else 7 end as ordem) f on true
  where c.status_padrao in ('Convertido', 'Perdido', 'Recusado')
  group by 1, 2, 3;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function atualizar_analise_mercado_faixa() from public, anon;
grant execute on function atualizar_analise_mercado_faixa() to authenticated, service_role;
