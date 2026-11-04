-- Oportunidades de venda cruzada por imobiliária (Matheus, 04/11/2026): aba "Dados estatísticos O2"
-- do Início, sub-aba "Oportunidades". Imobiliária que já tem um produto (>= 3 apólices em 2024-2026)
-- e ainda não tem outro. Lista explicável, sem rede neural: porte no produto-base, interesse recente
-- no produto-alvo (cotações abertas/perdidas/fechadas em 12 meses) e potencial estimado em apólices/ano.
--  * "tem o produto" = 3 ou mais apólices do produto (vigentes/vencidas, ano de vigência 2024-2026),
--    de analise_margem; imobiliária pelo banco único (imobiliaria_id), sem lista paralela.
--  * potencial = apólices/ano do produto-base × razão mediana (alvo ÷ base) observada nas imobiliárias
--    que já têm os dois produtos (2025-2026). É ordem de grandeza, não previsão.
-- Pares: Fiança→Incêndio, Fiança→Capitalização, Incêndio→Fiança, Incêndio→Capitalização.
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
  where imobiliaria_id is not null and ano between 2024 and 2026 and produto in ('Fiança', 'Incêndio imobiliário', 'Capitalização')
  group by 1, 2 having sum(apolices) >= 3;

  create temp table _par(base text, alvo text) on commit drop;
  insert into _par values ('Fiança', 'Incêndio imobiliário'), ('Fiança', 'Capitalização'), ('Incêndio imobiliário', 'Fiança'), ('Incêndio imobiliário', 'Capitalização');

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
         case p.produto when 'fianca' then 'Fiança' when 're' then 'Incêndio imobiliário' when 'capitalizacao' then 'Capitalização' end produto
  from producao_resolvida p
  where p.tipo = 'novo' and p.fonte in ('planilha', 'bitrix') and p.imobiliaria_id is not null and p.produto in ('fianca', 're', 'capitalizacao')
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
