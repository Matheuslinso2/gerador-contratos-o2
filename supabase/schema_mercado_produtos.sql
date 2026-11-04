-- Dados estatísticos O2 por produto (Matheus, 04/11/2026): a aba "Dados estatísticos O2"
-- do Início deixa de olhar só a Fiança e passa a ter Incêndio (re), Capitalização e Auto.
-- Tabelas prontas, remontadas 1x por dia (cron /api/cron/analise-precos). Mesmas regras de
-- schema_mercado_estatisticas.sql: cotação de contratação NOVA, 1 linha por caso (fica o
-- estado mais avançado), coorte pelo mês de ENTRADA, carteira da O2 (não o mercado inteiro).
--  * base de valor: re = aluguel; capitalizacao = valor do título (extras.valor_titulo);
--    automovel = sem base (amostra pequena).
--  * preço = só cotações CONVERTIDAS (a perdida não guarda prêmio); janela de 24 meses.
--  * seguradora normalizada por analise_seg_norm (Tokio, Porto, Yelum, Allianz, Brasilcap,
--    Icatu, Suhai; "Segimob" NÃO é seguradora (é a plataforma de cálculo) e entra como "Não informada").
-- Acesso: só colaborador O2.
create or replace function analise_seg_norm(s text) returns text language sql immutable as $$
  select case
    when s is null or btrim(s) = '' then 'Não informada'
    when upper(s) like 'SEGIMOB%' then 'Não informada'   -- Segimob é plataforma de cálculo, NÃO seguradora (Matheus, 04/11/2026)
    when upper(s) like '%TOKIO%' then 'Tokio'
    when upper(s) like 'PORTO%' then 'Porto'
    when upper(s) like '%YEL%' then 'Yelum'
    when upper(s) like 'ALLIANZ%' then 'Allianz'
    when upper(s) like 'BRASILCAP%' then 'Brasilcap'
    when upper(s) like 'ICATU%' then 'Icatu'
    when upper(s) like 'SUHAI%' then 'Suhai'
    when upper(s) ~ 'M[ÚU]LTIPLAS|COTAR EM' then 'Várias seguradoras'
    else 'Outras'
  end $$;

create table if not exists analise_prod_mes_faixa (
  produto text not null, mes date not null, faixa text not null, ordem int not null,
  decididas int not null, fechadas int not null, perdidas int not null,
  atualizado_em timestamptz not null default now(), primary key (produto, mes, faixa)
);
create table if not exists analise_prod_preco (
  produto text not null, seguradora text not null, n int not null,
  premio_med numeric, premio_p25 numeric, premio_p75 numeric,
  k_med numeric, k_p25 numeric, k_p75 numeric,        -- prêmio ÷ aluguel (re)
  titulo_med numeric, com_pct_med numeric,             -- valor do título (cap) e comissão ÷ prêmio
  atualizado_em timestamptz not null default now(), primary key (produto, seguradora)
);
create table if not exists analise_prod_seg_ano (
  produto text not null, ano int not null, seguradora text not null, n int not null, pct numeric not null,
  atualizado_em timestamptz not null default now(), primary key (produto, ano, seguradora)
);
create table if not exists analise_prod_regiao (
  produto text not null, cep5 text not null, cidade text, bairro text,
  n int not null, p25 numeric, mediana numeric, p75 numeric, premio_med numeric,
  atualizado_em timestamptz not null default now(), primary key (produto, cep5)
);
create table if not exists analise_prod_motivo (
  produto text not null, motivo text not null, n int not null,
  atualizado_em timestamptz not null default now(), primary key (produto, motivo)
);
create table if not exists analise_prod_segmento (
  produto text not null, segmento text not null, decididas int not null, fechadas int not null, premio_med numeric, k_med numeric,
  atualizado_em timestamptz not null default now(), primary key (produto, segmento)
);
create table if not exists analise_prod_imob (
  produto text not null, imobiliaria_id uuid not null, decididas int not null, fechadas int not null,
  atualizado_em timestamptz not null default now(), primary key (produto, imobiliaria_id)
);
do $$ declare t text; begin
  foreach t in array array['analise_prod_mes_faixa','analise_prod_preco','analise_prod_seg_ano','analise_prod_regiao','analise_prod_motivo','analise_prod_segmento','analise_prod_imob'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_colab', t);
    execute format('create policy %I on %I for select to authenticated using (is_colaborador_o2())', t||'_colab', t);
  end loop;
end $$;

create or replace function atualizar_analise_produtos() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;

  create temp table _p on commit drop as
  select distinct on (p.chave_caso)
         p.produto, p.status_padrao, p.premio, p.comissao, p.aluguel, p.data_recebimento, p.imobiliaria_id,
         analise_seg_norm(p.seguradora) seg,
         case when (p.extras ->> 'valor_titulo') ~ '^[0-9]+(\.[0-9]+)?$' then (p.extras ->> 'valor_titulo')::numeric end vt,
         case when (p.extras ->> 'cep') ~ '^[0-9]{8}$' then left(p.extras ->> 'cep', 5) end cep5,
         upper(nullif(btrim(p.extras ->> 'bairro'), '')) bairro,
         case when upper(coalesce(p.extras ->> 'ocupacao', '')) ~ 'APART|APTO|CASA|RESIDENC|CONDOM' then 'Residencial' when p.extras ->> 'ocupacao' is not null then 'Comercial / serviços' end segmento,
         upper(nullif(btrim(p.extras ->> 'motivo_desistencia'), '')) motivo
  from producao_resolvida p
  where p.produto in ('re', 'capitalizacao', 'automovel') and p.tipo = 'novo' and p.fonte in ('planilha', 'bitrix')
    and p.data_recebimento between date '2020-01-01' and current_date
  order by p.chave_caso,
           case p.status_padrao when 'Convertido' then 6 when 'Perdido' then 5 when 'Recusado' then 4 when 'Cancelado' then 3 when 'Aprovado' then 2 else 1 end desc,
           p.herdada asc;

  -- funil por mês e faixa de valor (coorte de entrada)
  delete from analise_prod_mes_faixa where true;
  insert into analise_prod_mes_faixa (produto, mes, faixa, ordem, decididas, fechadas, perdidas)
  select p.produto, date_trunc('month', p.data_recebimento)::date, f.faixa, f.ordem, count(*),
         count(*) filter (where p.status_padrao = 'Convertido'), count(*) filter (where p.status_padrao = 'Perdido')
  from _p p
  join lateral (select
      case when p.produto = 're' and p.aluguel is not null then
             case when p.aluguel < 1000 then '< 1.000' when p.aluguel < 1500 then '1.000-1.499' when p.aluguel < 2000 then '1.500-1.999'
                  when p.aluguel < 3000 then '2.000-2.999' when p.aluguel < 5000 then '3.000-4.999' when p.aluguel < 8000 then '5.000-7.999' else '8.000+' end
           when p.produto = 'capitalizacao' and p.vt is not null then
             case when p.vt < 5000 then '< 5.000' when p.vt < 10000 then '5.000-9.999' when p.vt < 15000 then '10.000-14.999'
                  when p.vt < 25000 then '15.000-24.999' when p.vt < 50000 then '25.000-49.999' else '50.000+' end
           else 'Sem informação' end faixa,
      case when p.produto = 're' and p.aluguel is not null then
             case when p.aluguel < 1000 then 1 when p.aluguel < 1500 then 2 when p.aluguel < 2000 then 3 when p.aluguel < 3000 then 4 when p.aluguel < 5000 then 5 when p.aluguel < 8000 then 6 else 7 end
           when p.produto = 'capitalizacao' and p.vt is not null then
             case when p.vt < 5000 then 1 when p.vt < 10000 then 2 when p.vt < 15000 then 3 when p.vt < 25000 then 4 when p.vt < 50000 then 5 else 6 end
           else 99 end ordem) f on true
  where p.status_padrao in ('Convertido', 'Perdido')
  group by 1, 2, 3, 4;

  -- preço praticado por seguradora (convertidas com prêmio, 24 meses)
  delete from analise_prod_preco where true;
  insert into analise_prod_preco (produto, seguradora, n, premio_med, premio_p25, premio_p75, k_med, k_p25, k_p75, titulo_med, com_pct_med)
  select produto, seg, count(*),
         percentile_cont(0.5) within group (order by premio), percentile_cont(0.25) within group (order by premio), percentile_cont(0.75) within group (order by premio),
         percentile_cont(0.5) within group (order by premio / aluguel) filter (where aluguel > 0),
         percentile_cont(0.25) within group (order by premio / aluguel) filter (where aluguel > 0),
         percentile_cont(0.75) within group (order by premio / aluguel) filter (where aluguel > 0),
         percentile_cont(0.5) within group (order by vt) filter (where vt > 0),
         percentile_cont(0.5) within group (order by comissao / premio) filter (where comissao is not null)
  from _p where status_padrao = 'Convertido' and premio > 0 and data_recebimento >= current_date - interval '24 months'
  group by produto, seg;

  delete from analise_prod_seg_ano where true;
  insert into analise_prod_seg_ano (produto, ano, seguradora, n, pct)
  select produto, ano, seg, n, round(100.0 * n / sum(n) over (partition by produto, ano), 1)
  from (select produto, extract(year from data_recebimento)::int ano, seg, count(*) n from _p where status_padrao = 'Convertido' group by 1, 2, 3) z;

  -- região do Incêndio (aluguel por CEP5, 24 meses); nome da cidade/bairro vem da base de Fiança (mesmo CEP5)
  delete from analise_prod_regiao where true;
  insert into analise_prod_regiao (produto, cep5, cidade, bairro, n, p25, mediana, p75, premio_med)
  select p.produto, p.cep5, max(g.cidade), coalesce(max(g.bairro), mode() within group (order by p.bairro)), count(*),
         percentile_cont(0.25) within group (order by p.aluguel), percentile_cont(0.5) within group (order by p.aluguel),
         percentile_cont(0.75) within group (order by p.aluguel), percentile_cont(0.5) within group (order by p.premio) filter (where p.premio > 0)
  from _p p left join analise_aluguel_cep5 g on g.cep5 = p.cep5
  where p.produto = 're' and p.cep5 is not null and p.aluguel between 300 and 40000 and p.data_recebimento >= current_date - interval '24 months'
  group by p.produto, p.cep5;

  -- motivos de desistência (Capitalização; todo o histórico)
  delete from analise_prod_motivo where true;
  insert into analise_prod_motivo (produto, motivo, n)
  select produto, motivo, count(*) from _p where status_padrao = 'Perdido' and motivo is not null group by 1, 2;

  -- Incêndio: residencial x comercial (24 meses)
  delete from analise_prod_segmento where true;
  insert into analise_prod_segmento (produto, segmento, decididas, fechadas, premio_med, k_med)
  select produto, segmento, count(*), count(*) filter (where status_padrao = 'Convertido'),
         percentile_cont(0.5) within group (order by premio) filter (where status_padrao = 'Convertido' and premio > 0),
         percentile_cont(0.5) within group (order by premio / aluguel) filter (where status_padrao = 'Convertido' and premio > 0 and aluguel > 0)
  from _p where produto = 're' and segmento is not null and status_padrao in ('Convertido', 'Perdido') and data_recebimento >= current_date - interval '24 months'
  group by produto, segmento;

  -- por imobiliária (banco único), 24 meses
  delete from analise_prod_imob where true;
  insert into analise_prod_imob (produto, imobiliaria_id, decididas, fechadas)
  select produto, imobiliaria_id, count(*), count(*) filter (where status_padrao = 'Convertido')
  from _p where imobiliaria_id is not null and status_padrao in ('Convertido', 'Perdido') and data_recebimento >= current_date - interval '24 months'
  group by produto, imobiliaria_id;

  select count(*) into v_n from analise_prod_mes_faixa;
  return v_n;
end $$;
revoke all on function atualizar_analise_produtos() from public, anon;
grant execute on function atualizar_analise_produtos() to authenticated, service_role;
