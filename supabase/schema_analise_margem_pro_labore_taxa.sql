-- Pró-labore negociado (Matheus, 03/11/2026): se uma fatura/linha é pró-labore,
-- a taxa tende a ser fixa por imobiliária × seguradora × produto (a fatura da
-- O2 é a mesma chave). Medido nas linhas dos extratos (erp_extrato_linhas.
-- pct_pro_labore = % do cadastro − % pago): 78 das 106 combinações têm uma
-- taxa só (>= 90% das linhas, 3+ linhas). Essa taxa é usada na margem SÓ onde
-- o documento não tem o % lido nem regra confirmada, e fica marcada como
-- INFERIDA (pro_labore_inferido), nunca gravada no documento do ERP.
-- Substitui a função de schema_analise_margem.sql (mesma assinatura).
create table if not exists analise_pro_labore_taxa (
  imobiliaria_id uuid not null,
  seguradora_id uuid not null,
  ramo text not null,
  taxa numeric not null,
  linhas int not null,
  linhas_taxa int not null,
  pct_igual numeric not null,
  estavel boolean not null,
  atualizado_em timestamptz not null default now(),
  primary key (imobiliaria_id, seguradora_id, ramo)
);
alter table analise_pro_labore_taxa enable row level security;
drop policy if exists apt_colaborador_o2 on analise_pro_labore_taxa;
create policy apt_colaborador_o2 on analise_pro_labore_taxa for select to authenticated using (is_colaborador_o2());
alter table analise_margem add column if not exists pro_labore_inferido numeric not null default 0;
alter table analise_margem add column if not exists apolices_pl_inferido int not null default 0;

create or replace function atualizar_analise_margem() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  delete from analise_pro_labore_taxa where true;
  insert into analise_pro_labore_taxa (imobiliaria_id, seguradora_id, ramo, taxa, linhas, linhas_taxa, pct_igual, estavel)
  with l as (
    select round(e.pct_pro_labore::numeric, 1) pl, d.imobiliaria_principal_id imob, d.seguradora_id seg,
           regexp_replace(upper(r.nome), '^2 ', '') ramo
    from erp_extrato_linhas e join erp_documentos d on d.id = e.documento_id left join erp_ramos r on r.id = d.ramo_id
    where e.pct_pro_labore > 0 and d.imobiliaria_principal_id is not null and d.seguradora_id is not null
  ), c as (select imob, seg, ramo, pl, count(*) qtd from l group by 1, 2, 3, 4),
  g as (select imob, seg, ramo, sum(qtd) tot, (array_agg(pl order by qtd desc))[1] taxa, max(qtd) n_taxa from c group by 1, 2, 3)
  select imob, seg, ramo, taxa, tot, n_taxa, round(100.0 * n_taxa / tot, 1), (100.0 * n_taxa / tot >= 90 and tot >= 3) from g;

  delete from analise_margem where true;
  insert into analise_margem (imobiliaria_id, ano, produto, seguradora, apolices, premio_liquido, comissao, repasse, sem_comissao, sem_repasse, pro_labore, sem_pct_pro_labore, pro_labore_inferido, apolices_pl_inferido)
  with rep as (
    select documento_id, sum(coalesce(repasse_valor_previsto, 0)) rep from erp_documento_produtores group by 1
  )
  select d.imobiliaria_principal_id,
         extract(year from d.vigencia_inicio)::int,
         case regexp_replace(upper(r.nome), '^2 ', '')
           when 'IMOBILIARIO' then 'Incêndio imobiliário'
           when 'FIANCA LOCATICIA' then 'Fiança'
           when 'FIANÇA' then 'Fiança'
           when 'CAPITALIZAÇÃO' then 'Capitalização'
           when 'RESIDENCIAL' then 'Residencial'
           when 'EMPRESARIAL' then 'Empresarial'
           when 'CONDOMINIO' then 'Condomínio'
           when 'AUTOMOVEL' then 'Automóvel'
           when 'SAÚDE' then 'Saúde/Odonto'
           when 'ODONTO' then 'Saúde/Odonto'
           else 'Outros'
         end,
         coalesce(s.nome, '(sem seguradora)'),
         count(*), coalesce(sum(d.premio_liquido), 0), coalesce(sum(d.comissao_valor), 0), coalesce(sum(rep.rep), 0) + coalesce(sum(pl.valor), 0),
         count(*) filter (where coalesce(d.comissao_valor, 0) = 0),
         count(*) filter (where rep.documento_id is null),
         coalesce(sum(pl.valor) filter (where not pl.inferido), 0), count(*) filter (where pl.sem_pct),
         coalesce(sum(pl.valor) filter (where pl.inferido), 0), count(*) filter (where pl.inferido)
  from erp_documentos d
  left join erp_ramos r on r.id = d.ramo_id
  left join erp_seguradoras s on s.id = d.seguradora_id
  left join rep on rep.documento_id = d.id
  left join lateral (
    select case when d.pro_labore_pct is not null then d.premio_liquido * d.pro_labore_pct / 100
                when x.pct is not null then d.premio_liquido * x.pct / 100
                when t.taxa is not null then d.premio_liquido * t.taxa / 100
                else 0 end as valor,
           (d.pro_labore_pct is null and x.pct is null and t.taxa is not null) as inferido,
           (d.pro_labore_pct is null and x.pct is null and t.taxa is null and coalesce(d.pro_labore_presente, false)) as sem_pct
    from (select 1) u
    left join lateral (
      select pct from erp_repasse_direto_seguradora x
      where x.confirmado and x.imobiliaria_id = d.imobiliaria_principal_id and x.seguradora_id = d.seguradora_id
        and d.vigencia_inicio >= coalesce(x.desde, date '1900-01-01') and d.vigencia_inicio <= coalesce(x.ate, date '9999-12-31')
      order by x.desde desc nulls last limit 1
    ) x on d.pro_labore_pct is null and coalesce(d.pro_labore_presente, false)
    left join analise_pro_labore_taxa t on d.pro_labore_pct is null and x.pct is null and coalesce(d.pro_labore_presente, false) and t.estavel
      and t.imobiliaria_id = d.imobiliaria_principal_id and t.seguradora_id = d.seguradora_id and t.ramo = regexp_replace(upper(r.nome), '^2 ', '')
  ) pl on true
  where d.tipo = 'A' and d.situacao in ('vigente', 'vencido')
    and d.vigencia_inicio between '2020-01-01' and '2026-12-31'
  group by 1, 2, 3, 4;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function atualizar_analise_margem() from public, anon;
grant execute on function atualizar_analise_margem() to authenticated, service_role;
