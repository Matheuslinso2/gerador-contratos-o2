-- Ficha de visita da imobiliária (Matheus, 03/11/2026 — projeto análise de preços,
-- Etapa 3). Vive dentro da aba Imobiliária 360 (/producao). Tabelas prontas
-- (retrato) para ler em <1 s; atualizadas por atualizar_analise_visita().
-- Regras:
--  * base = cotações de Fiança de contratação NOVA (tipo 'novo'; renovação fica de
--    fora), 1 linha por caso (a planilha repete o caso nos meses seguintes:
--    fica o estado mais avançado), últimos 24 meses, aluguel entre R$ 300 e 40.000
--    e CEP de 8 dígitos. Aluguel de região = carteira O2 (não é o mercado inteiro).
--  * imobiliária pelo banco único (producao_resolvida.imobiliaria_id; só vínculo
--    confirmado). Nada de lista paralela.
--  * REGRA DO MATHEUS: com endereços suficientes da própria imobiliária
--    (>= 30 cotações com CEP em 24 meses) usa os dados dela (base 'propria');
--    com pouca produção usa o estudo dos bairros (CEP de 5 dígitos) onde ela
--    tem cotações (base 'bairros'); sem nenhum endereço usa a cidade da ficha
--    (base 'cidade'); sem nada, 'sem_dados'.
--  * preço do seguro = prêmio anual em aluguéis por seguradora (mediana das
--    fechadas de 2024+, prêmio entre 0,3 e 12 aluguéis); parcela = prêmio / 12.
-- Acesso: só colaborador O2 (is_colaborador_o2).

create table if not exists analise_aluguel_cep5 (
  cep5 text primary key, cidade text, uf text, bairro text,
  n int not null, p25 numeric, mediana numeric, p75 numeric,
  atualizado_em timestamptz not null default now()
);
create table if not exists analise_aluguel_cidade (
  cidade text not null, uf text not null,
  n int not null, p25 numeric, mediana numeric, p75 numeric,
  atualizado_em timestamptz not null default now(),
  primary key (cidade, uf)
);
create table if not exists analise_preco_seguradora (
  seguradora text primary key,
  apolices int not null, premio_alugueis_mediana numeric not null,
  premio_alugueis_p25 numeric, premio_alugueis_p75 numeric,
  atualizado_em timestamptz not null default now()
);
create table if not exists analise_visita_imob (
  tipo text not null default 'i', -- 'i' = imobiliária, 'g' = grupo (soma de todas as fichas do grupo)
  chave uuid not null,
  cotacoes_24m int not null, cotacoes_cep_24m int not null,
  decididas_24m int not null, fechadas_24m int not null,
  aluguel_p25 numeric, aluguel_mediana numeric, aluguel_p75 numeric,
  conv_esperada numeric, -- % que a O2 fecharia com o perfil de aluguel dela (conversão média da O2 por faixa)
  base text not null,
  areas jsonb not null default '[]'::jsonb, -- [{cep5,bairro,cidade,n,mediana_imob}]
  atualizado_em timestamptz not null default now(),
  primary key (tipo, chave)
);
create table if not exists analise_conv_faixa (
  faixa text primary key, ordem int not null, decididas int not null, conv numeric not null,
  atualizado_em timestamptz not null default now()
);
alter table analise_aluguel_cep5 enable row level security;
alter table analise_aluguel_cidade enable row level security;
alter table analise_preco_seguradora enable row level security;
alter table analise_visita_imob enable row level security;
alter table analise_conv_faixa enable row level security;
do $$ declare t text; begin
  foreach t in array array['analise_aluguel_cep5','analise_aluguel_cidade','analise_preco_seguradora','analise_visita_imob','analise_conv_faixa'] loop
    execute format('drop policy if exists %I on %I', t||'_colab', t);
    execute format('create policy %I on %I for select to authenticated using (is_colaborador_o2())', t||'_colab', t);
  end loop;
end $$;

create or replace function atualizar_analise_visita() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_k int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;

  create temp table _casos on commit drop as
  select distinct on (p.chave_caso)
         p.chave_caso, p.imobiliaria_id, p.status_padrao, p.aluguel, p.data_recebimento,
         case when (p.extras ->> 'cep') ~ '^[0-9]{8}$' then left(p.extras ->> 'cep', 5) end as cep5,
         upper(nullif(p.extras ->> 'cidade', '')) as cidade, upper(nullif(p.extras ->> 'uf', '')) as uf,
         upper(nullif(p.extras ->> 'bairro', '')) as bairro
  from producao_resolvida p
  where p.produto = 'fianca' and p.tipo = 'novo' and p.fonte in ('planilha', 'bitrix')
    and p.aluguel between 300 and 40000
    and p.data_recebimento between current_date - interval '24 months' and current_date
  order by p.chave_caso,
           case p.status_padrao when 'Convertido' then 6 when 'Perdido' then 5 when 'Recusado' then 4 when 'Cancelado' then 3 when 'Aprovado' then 2 else 1 end desc,
           p.herdada asc;

  -- aluguel por CEP5 e por cidade (carteira O2, todas as imobiliárias)
  delete from analise_aluguel_cep5 where true;
  insert into analise_aluguel_cep5 (cep5, cidade, uf, bairro, n, p25, mediana, p75)
  select cep5, mode() within group (order by cidade), mode() within group (order by uf), mode() within group (order by bairro),
         count(*), percentile_cont(0.25) within group (order by aluguel), percentile_cont(0.5) within group (order by aluguel),
         percentile_cont(0.75) within group (order by aluguel)
  from _casos where cep5 is not null group by cep5;

  delete from analise_aluguel_cidade where true;
  insert into analise_aluguel_cidade (cidade, uf, n, p25, mediana, p75)
  select cidade, coalesce(uf, '??'), count(*), percentile_cont(0.25) within group (order by aluguel),
         percentile_cont(0.5) within group (order by aluguel), percentile_cont(0.75) within group (order by aluguel)
  from _casos where cidade is not null group by cidade, coalesce(uf, '??') having count(*) >= 5;

  -- conversão média da O2 por faixa de aluguel (fechadas ÷ decididas)
  delete from analise_conv_faixa where true;
  insert into analise_conv_faixa (faixa, ordem, decididas, conv)
  select f.faixa, f.ordem, count(*), round(100.0 * count(*) filter (where status_padrao = 'Convertido') / count(*), 1)
  from _casos c
  join lateral (select case when aluguel < 1000 then '< 1.000' when aluguel < 1500 then '1.000-1.499' when aluguel < 2000 then '1.500-1.999'
                            when aluguel < 3000 then '2.000-2.999' when aluguel < 5000 then '3.000-4.999' when aluguel < 8000 then '5.000-7.999' else '8.000+' end as faixa,
                       case when aluguel < 1000 then 1 when aluguel < 1500 then 2 when aluguel < 2000 then 3 when aluguel < 3000 then 4
                            when aluguel < 5000 then 5 when aluguel < 8000 then 6 else 7 end as ordem) f on true
  where c.status_padrao in ('Convertido', 'Perdido', 'Recusado')
  group by f.faixa, f.ordem;

  -- preço praticado por seguradora (fechadas de 2024 em diante, prêmio em aluguéis)
  delete from analise_preco_seguradora where true;
  insert into analise_preco_seguradora (seguradora, apolices, premio_alugueis_mediana, premio_alugueis_p25, premio_alugueis_p75)
  with b as (
    select case
             when upper(p.seguradora) ~ '^(POTT).*(TF|TAXA FIXA)' then 'Pottencial Taxa Fixa'
             when upper(p.seguradora) like 'POTT%' then 'Pottencial Tradicional'
             when upper(p.seguradora) like 'ESSENCIAL%' or upper(p.seguradora) like 'PORTO ESSENCIAL%' then 'Porto Essencial'
             when upper(p.seguradora) like 'PORTO%' then 'Porto Tradicional'
             when upper(p.seguradora) like 'TOKIO%' then 'Tokio'
             when upper(p.seguradora) like 'TOO%' then 'Too'
           end as seg, p.premio / p.aluguel as k
    from producao_resolvida p
    where p.produto = 'fianca' and p.tipo = 'novo' and p.fonte in ('planilha', 'bitrix') and p.status_padrao = 'Convertido'
      and p.aluguel between 300 and 40000 and p.premio is not null and p.data_recebimento >= date '2024-01-01'
      and p.premio between p.aluguel * 0.3 and p.aluguel * 12
  )
  select seg, count(*), percentile_cont(0.5) within group (order by k), percentile_cont(0.25) within group (order by k), percentile_cont(0.75) within group (order by k)
  from b where seg is not null group by seg having count(*) >= 30;

  -- por imobiliária e por grupo (mesmas regras)
  create temp table _ent on commit drop as
  select 'i'::text tipo, imobiliaria_id chave, c.* from _casos c where imobiliaria_id is not null
  union all
  select 'g', i.grupo_id, c.* from _casos c join imobiliarias i on i.id = c.imobiliaria_id where i.grupo_id is not null;

  delete from analise_visita_imob where true;
  insert into analise_visita_imob (tipo, chave, cotacoes_24m, cotacoes_cep_24m, decididas_24m, fechadas_24m, aluguel_p25, aluguel_mediana, aluguel_p75, conv_esperada, base, areas)
  with m as (
    select tipo, chave,
           count(*) cot, count(*) filter (where cep5 is not null) cot_cep,
           count(*) filter (where status_padrao in ('Convertido', 'Perdido', 'Recusado')) dec,
           count(*) filter (where status_padrao = 'Convertido') fech,
           percentile_cont(0.25) within group (order by aluguel) p25,
           percentile_cont(0.5) within group (order by aluguel) med,
           percentile_cont(0.75) within group (order by aluguel) p75
    from _ent group by tipo, chave
  ), ar as (
    select c.tipo, c.chave,
           jsonb_agg(jsonb_build_object('cep5', c.cep5, 'bairro', g.bairro, 'cidade', g.cidade, 'n', c.n, 'mediana_imob', c.med,
                                        'n_regiao', g.n, 'mediana_regiao', g.mediana) order by c.n desc) filter (where c.rn <= 8) areas
    from (select tipo, chave, cep5, count(*) n, percentile_cont(0.5) within group (order by aluguel) med,
                 row_number() over (partition by tipo, chave order by count(*) desc) rn
          from _ent where cep5 is not null group by tipo, chave, cep5) c
    join analise_aluguel_cep5 g on g.cep5 = c.cep5
    group by c.tipo, c.chave
  ), ce as (
    select e.tipo, e.chave, sum(f.conv) / nullif(count(*), 0) as esperada
    from _ent e
    join lateral (select case when e.aluguel < 1000 then '< 1.000' when e.aluguel < 1500 then '1.000-1.499' when e.aluguel < 2000 then '1.500-1.999'
                              when e.aluguel < 3000 then '2.000-2.999' when e.aluguel < 5000 then '3.000-4.999' when e.aluguel < 8000 then '5.000-7.999' else '8.000+' end as faixa) x on true
    join analise_conv_faixa f on f.faixa = x.faixa
    where e.status_padrao in ('Convertido', 'Perdido', 'Recusado')
    group by e.tipo, e.chave
  )
  select m.tipo, m.chave, m.cot, m.cot_cep, m.dec, m.fech, m.p25, m.med, m.p75, round(ce.esperada, 1),
         case when m.cot_cep >= 30 then 'propria' when m.cot_cep > 0 then 'bairros' else 'sem_dados' end,
         coalesce(ar.areas, '[]'::jsonb)
  from m left join ar using (tipo, chave) left join ce using (tipo, chave);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function atualizar_analise_visita() from public, anon;
grant execute on function atualizar_analise_visita() to authenticated, service_role;
