-- Margem por apólice vendida (Matheus, 03/11/2026 — projeto análise de preços,
-- Etapa 2). Margem = comissão da apólice − repasse previsto aos produtores
-- (imobiliárias). Tabela pronta (retrato) por imobiliária × ano × produto ×
-- seguradora, para a ficha de visita da Imobiliária 360 ler em <1 s.
-- Vínculo com a imobiliária = imobiliaria_principal_id do documento (banco
-- único de imobiliárias; nada de lista paralela). Regras:
--  * só apólices (tipo 'A') vigentes ou vencidas; cancelada/duplicada/cotação/
--    proposta ficam de fora; endossos ficam de fora (ajustam a apólice);
--  * ano = início de vigência (regra Corp/ERP); vigência até 31/12/2026
--    (datas futuras absurdas são erro de digitação e ficam de fora);
--  * repasse = repasse previsto aos produtores + PRÓ-LABORE (Matheus, 03/11:
--    pró-labore é repasse negociado com a imobiliária, só muda o caminho do
--    dinheiro). Pró-labore = % × prêmio líquido, com % lido do documento
--    (extrato Segimob) ou, na falta, da regra confirmada da imobiliária com a
--    seguradora (erp_repasse_direto_seguradora). Documento com pró-labore
--    presente e % desconhecido conta em sem_pct_pro_labore (valor 0, a conferir).
--  * tudo é PREVISTO, não o repasse efetivamente pago.
-- Acesso: só colaborador O2 (is_colaborador_o2).
create table if not exists analise_margem (
  imobiliaria_id uuid,
  ano int not null,
  produto text not null,
  seguradora text not null,
  apolices int not null,
  premio_liquido numeric not null,
  comissao numeric not null,
  repasse numeric not null,
  sem_comissao int not null default 0,
  sem_repasse int not null default 0,
  pro_labore numeric not null default 0, -- parte do repasse que é pró-labore
  sem_pct_pro_labore int not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table analise_margem add column if not exists pro_labore numeric not null default 0;
alter table analise_margem add column if not exists sem_pct_pro_labore int not null default 0;
create unique index if not exists analise_margem_uidx on analise_margem (coalesce(imobiliaria_id, '00000000-0000-0000-0000-000000000000'::uuid), ano, produto, seguradora);
create index if not exists analise_margem_imob_idx on analise_margem (imobiliaria_id);
alter table analise_margem enable row level security;
drop policy if exists analise_margem_colaborador_o2 on analise_margem;
create policy analise_margem_colaborador_o2 on analise_margem for select to authenticated using (is_colaborador_o2());

create or replace function atualizar_analise_margem() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  delete from analise_margem where true;
  insert into analise_margem (imobiliaria_id, ano, produto, seguradora, apolices, premio_liquido, comissao, repasse, sem_comissao, sem_repasse, pro_labore, sem_pct_pro_labore)
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
         coalesce(sum(pl.valor), 0), count(*) filter (where pl.sem_pct)
  from erp_documentos d
  left join erp_ramos r on r.id = d.ramo_id
  left join erp_seguradoras s on s.id = d.seguradora_id
  left join rep on rep.documento_id = d.id
  left join lateral (
    select case when d.pro_labore_pct is not null then d.premio_liquido * d.pro_labore_pct / 100
                when x.pct is not null then d.premio_liquido * x.pct / 100
                else 0 end as valor,
           (d.pro_labore_pct is null and x.pct is null and coalesce(d.pro_labore_presente, false)) as sem_pct
    from (select 1) u
    left join lateral (
      select pct from erp_repasse_direto_seguradora x
      where x.confirmado and x.imobiliaria_id = d.imobiliaria_principal_id and x.seguradora_id = d.seguradora_id
        and d.vigencia_inicio >= coalesce(x.desde, date '1900-01-01') and d.vigencia_inicio <= coalesce(x.ate, date '9999-12-31')
      order by x.desde desc nulls last limit 1
    ) x on d.pro_labore_pct is null and coalesce(d.pro_labore_presente, false)
  ) pl on true
  where d.tipo = 'A' and d.situacao in ('vigente', 'vencido')
    and d.vigencia_inicio between '2020-01-01' and '2026-12-31'
  group by 1, 2, 3, 4;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function atualizar_analise_margem() from public, anon;
grant execute on function atualizar_analise_margem() to authenticated, service_role;
