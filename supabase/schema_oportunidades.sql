-- Oportunidades de venda cruzada por imobiliária (Matheus, 04/11/2026): aba "Dados estatísticos O2"
-- do Início, sub-aba "Oportunidades". Imobiliária que já tem um produto (>= 3 apólices em 2024-2026)
-- e ainda não tem outro. Lista explicável, sem rede neural: porte no produto-base, interesse recente
-- no produto-alvo (cotações abertas/perdidas/fechadas em 12 meses) e potencial estimado em apólices/ano.
--  * "tem o produto" = 3 ou mais apólices do produto (vigentes/vencidas, ano de vigência 2024-2026),
--    de analise_margem; imobiliária pelo banco único (imobiliaria_id), sem lista paralela.
--  * potencial = apólices/ano do produto-base × razão mediana (alvo ÷ base) observada nas imobiliárias
--    que já têm os dois produtos (2025-2026). É ordem de grandeza, não previsão.
-- Pares: base Fiança ou Incêndio → qualquer outro produto (Fiança, Incêndio, Capitalização, Residencial,
-- Empresarial, Condomínio, Automóvel). Residencial/Empresarial/Condomínio: as cotações vêm juntas no
-- Incêndio (re) e não dá para separar o interesse recente (colunas de cotação ficam zeradas).
-- Acesso: só colaborador O2.
create table if not exists analise_oportunidades_razao (
  produto_base text not null, produto_alvo text not null, razao numeric, n int not null,
  atualizado_em timestamptz not null default now(), primary key (produto_base, produto_alvo)
);
create table if not exists analise_oportunidades (
  imobiliaria_id uuid not null, produto_base text not null, produto_alvo text not null,
  apolices_base int not null, premio_base numeric not null,
  cot_abertas_alvo int not null default 0, cot_perdidas_12m_alvo int not null default 0, cot_fechadas_12m_alvo int not null default 0,
  potencial_apolices_ano numeric,
  atualizado_em timestamptz not null default now(), primary key (imobiliaria_id, produto_base, produto_alvo)
);
alter table analise_oportunidades_razao enable row level security;
alter table analise_oportunidades enable row level security;
drop policy if exists analise_oportunidades_razao_colab on analise_oportunidades_razao;
drop policy if exists analise_oportunidades_colab on analise_oportunidades;
create policy analise_oportunidades_razao_colab on analise_oportunidades_razao for select to authenticated using (is_colaborador_o2());
create policy analise_oportunidades_colab on analise_oportunidades for select to authenticated using (is_colaborador_o2());

create or replace function atualizar_analise_oportunidades() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;

  create temp table _prod on commit drop as
  select imobiliaria_id, produto, sum(apolices) ap_total, sum(apolices) filter (where ano in (2025, 2026)) ap_2526, sum(premio_liquido) filter (where ano in (2025, 2026)) prem_2526
  from analise_margem
  where imobiliaria_id is not null and ano between 2024 and 2026 and produto in ('Fiança', 'Incêndio imobiliário', 'Capitalização', 'Residencial', 'Empresarial', 'Condomínio', 'Automóvel')
  group by 1, 2 having sum(apolices) >= 3;

  create temp table _par(base text, alvo text) on commit drop;
  insert into _par
  select b, a from (values ('Fiança'), ('Incêndio imobiliário')) bb(b)
  cross join (values ('Fiança'), ('Incêndio imobiliário'), ('Capitalização'), ('Residencial'), ('Empresarial'), ('Condomínio'), ('Automóvel')) aa(a)
  where b <> a;

  delete from analise_oportunidades_razao where true;
  insert into analise_oportunidades_razao (produto_base, produto_alvo, razao, n)
  select p.base, p.alvo,
         percentile_cont(0.5) within group (order by coalesce(a.ap_2526, 0)::numeric / nullif(b.ap_2526, 0)) filter (where b.ap_2526 > 0),
         count(*) filter (where b.ap_2526 > 0)
  from _par p
  join _prod b on b.produto = p.base
  join _prod a on a.produto = p.alvo and a.imobiliaria_id = b.imobiliaria_id
  group by p.base, p.alvo;

  create temp table _cot on commit drop as
  select distinct on (p.chave_caso) p.imobiliaria_id, p.status_padrao, p.data_recebimento,
         case p.produto when 'fianca' then 'Fiança' when 're' then 'Incêndio imobiliário' when 'capitalizacao' then 'Capitalização' when 'automovel' then 'Automóvel' end produto
  from producao_resolvida p
  where p.tipo = 'novo' and p.fonte in ('planilha', 'bitrix') and p.imobiliaria_id is not null and p.produto in ('fianca', 're', 'capitalizacao', 'automovel')
    and p.data_recebimento between current_date - interval '12 months' and current_date
  order by p.chave_caso,
           case p.status_padrao when 'Convertido' then 6 when 'Perdido' then 5 when 'Recusado' then 4 when 'Cancelado' then 3 when 'Aprovado' then 2 else 1 end desc,
           p.herdada asc;

  delete from analise_oportunidades where true;
  insert into analise_oportunidades (imobiliaria_id, produto_base, produto_alvo, apolices_base, premio_base, cot_abertas_alvo, cot_perdidas_12m_alvo, cot_fechadas_12m_alvo, potencial_apolices_ano)
  select b.imobiliaria_id, p.base, p.alvo, coalesce(b.ap_2526, 0), coalesce(b.prem_2526, 0),
         count(c.*) filter (where c.status_padrao in ('Em análise', 'Aprovado')),
         count(c.*) filter (where c.status_padrao in ('Perdido', 'Recusado')),
         count(c.*) filter (where c.status_padrao = 'Convertido'),
         round(coalesce(b.ap_2526, 0)::numeric / 2 * coalesce(r.razao, 0), 1)
  from _par p
  join _prod b on b.produto = p.base
  left join analise_oportunidades_razao r on r.produto_base = p.base and r.produto_alvo = p.alvo
  left join _cot c on c.imobiliaria_id = b.imobiliaria_id and c.produto = p.alvo
  where not exists (select 1 from _prod a where a.imobiliaria_id = b.imobiliaria_id and a.produto = p.alvo)
  group by b.imobiliaria_id, p.base, p.alvo, b.ap_2526, b.prem_2526, r.razao;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function atualizar_analise_oportunidades() from public, anon;
grant execute on function atualizar_analise_oportunidades() to authenticated, service_role;

-- Taxa histórica de venda cruzada dos clientes de cada imobiliária (só Fiança <-> Incêndio, onde há casos
-- suficientes; a tela só mostra com 40+ clientes). Candidato = cliente cuja 1ª compra do produto-base foi
-- >= 2021 e há >= 12 meses, sem o alvo em até 30 dias (pacote). Roda DEPOIS de atualizar_analise_oportunidades.
alter table analise_oportunidades add column if not exists vc_candidatos int;
alter table analise_oportunidades add column if not exists vc_compraram int;
create or replace function atualizar_analise_oportunidades_vc() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  with d2 as (
    select e.locatario_id, e.imobiliaria_principal_id imob, e.vigencia_inicio vi,
           case regexp_replace(upper(r.nome), '^2 ', '') when 'IMOBILIARIO' then 'Incêndio imobiliário' when 'FIANCA LOCATICIA' then 'Fiança' when 'FIANÇA' then 'Fiança' end prod
    from erp_documentos e join erp_ramos r on r.id = e.ramo_id
    where e.tipo = 'A' and e.situacao in ('vigente', 'vencido', 'cancelado') and e.vigencia_inicio between date '2020-01-01' and current_date
      and e.locatario_id is not null and e.imobiliaria_principal_id is not null
  ), d as (select * from d2 where prod is not null),
  base as (select locatario_id, prod, min(vi) t0, (array_agg(imob order by vi))[1] imob from d group by 1, 2),
  ad as (select locatario_id, prod, array_agg(vi) dts from d group by 1, 2),
  par as (select * from (values ('Fiança', 'Incêndio imobiliário'), ('Incêndio imobiliário', 'Fiança')) v(b, a)),
  c as (
    select b.imob, p.b base, p.a alvo, b.t0, coalesce(x.dts, '{}'::date[]) dts
    from base b join par p on p.b = b.prod left join ad x on x.locatario_id = b.locatario_id and x.prod = p.a
    where b.t0 >= date '2021-01-01' and b.t0 + 365 <= current_date
  ), f as (
    select imob, base, alvo,
           exists (select 1 from unnest(dts) z where z <= t0 + 30) ja,
           exists (select 1 from unnest(dts) z where z > t0 + 30 and z <= t0 + 365) comprou
    from c
  ), agg as (
    select imob, base, alvo, count(*) filter (where not ja) cand, count(*) filter (where not ja and comprou) comp from f group by 1, 2, 3
  )
  update analise_oportunidades o set vc_candidatos = a.cand, vc_compraram = a.comp
  from agg a where o.imobiliaria_id = a.imob and o.produto_base = a.base and o.produto_alvo = a.alvo;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function atualizar_analise_oportunidades_vc() from public, anon;
grant execute on function atualizar_analise_oportunidades_vc() to authenticated, service_role;
