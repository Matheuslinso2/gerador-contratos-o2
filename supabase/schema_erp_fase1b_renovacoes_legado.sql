-- ERP O2 — Fase 1b: corrente de renovações do legado do Corp (25/10/2026)
-- O Corp liga cada renovação à apólice anterior pelo "Nº Apólice Renovada" e mostra a família
-- (53067 → 94579 → 103208 → 114924 → 133629) na coluna esquerda do Controle de Documentos.
-- O espelho (grade) não traz esse campo, então a corrente é reconstruída:
--   mesmo cliente + mesmo produto (fiança/incêndio/cap…) + apólice (tipo A) + anterior que
--   termina perto do início desta (±60 dias) OU que foi substituída no meio (mesmo fim de vigência).
-- Desempate: substituição no meio da vigência primeiro, depois o fim mais perto do início, depois o início
-- mais recente (reproduz 53067 → 94579 → 103208 → 114924 da Lia Mara).
-- Quando o robô trouxer o relatório "Documentos → Renovações" do Corp, o vínculo exato substitui este.
create or replace function erp_ligar_renovacoes_legado(p_de date default '2020-01-01', p_ate date default '2030-01-01')
returns table (ligadas int, sem_candidato int)
language plpgsql security definer set search_path = public as $$
declare v_lig int; v_sem int;
begin
  alter table erp_documentos disable trigger erp_documentos_aud;
  create temp table _ren on commit drop as
  select d.id, (
    select d2.id from erp_documentos d2
    join erp_ramos r2 on r2.id = d2.ramo_id
    where d2.locatario_id = d.locatario_id and d2.id <> d.id and d2.tipo = 'A' and d2.tipo_corp <> 'CANC'
      and r2.produto = r.produto and d2.vigencia_inicio < d.vigencia_inicio
      and (d2.vigencia_fim between d.vigencia_inicio - 60 and d.vigencia_inicio + 60
           or (d2.vigencia_fim = d.vigencia_fim and d2.seguradora_id = d.seguradora_id and d.vigencia_inicio between d2.vigencia_inicio and d2.vigencia_fim))
    -- 1º substituição no meio da vigência (mesmo fim, mesma seguradora); 2º fim mais perto do início; 3º início mais recente
    order by (d2.vigencia_fim = d.vigencia_fim and d2.seguradora_id = d.seguradora_id and d.vigencia_inicio between d2.vigencia_inicio and d2.vigencia_fim) desc,
             abs(d2.vigencia_fim - d.vigencia_inicio), d2.vigencia_inicio desc
    limit 1
  ) as anterior_id
  from erp_documentos d join erp_ramos r on r.id = d.ramo_id
  where d.origem = 'corp_import' and d.tipo = 'A' and d.tipo_corp = 'RENV' and d.documento_renovado_id is null
    and d.locatario_id is not null and d.vigencia_inicio >= p_de and d.vigencia_inicio < p_ate;
  update erp_documentos d set documento_renovado_id = x.anterior_id from _ren x where x.id = d.id and x.anterior_id is not null;
  get diagnostics v_lig = row_count;
  select count(*) into v_sem from _ren where anterior_id is null;
  alter table erp_documentos enable trigger erp_documentos_aud;
  return query select v_lig, v_sem;
end $$;
revoke all on function erp_ligar_renovacoes_legado(date, date) from public;

-- Família completa de um documento (para a ficha mostrar a thread como o Corp)
create or replace function erp_familia_documento(p_id uuid)
returns table (id uuid, nosso_numero bigint, nosso_numero_corp bigint, tipo_corp text, situacao text, vigencia_inicio date, vigencia_fim date, numero_apolice text, nivel int)
language sql stable set search_path = public as $$
  with recursive tras as (
    select d.id, d.documento_renovado_id, 0 as nivel from erp_documentos d where d.id = p_id
    union all
    select d.id, d.documento_renovado_id, t.nivel - 1 from erp_documentos d join tras t on d.id = t.documento_renovado_id where t.nivel > -30
  ), frente as (
    select d.id, 0 as nivel from erp_documentos d where d.id = p_id
    union all
    select d.id, f.nivel + 1 from erp_documentos d join frente f on d.documento_renovado_id = f.id where f.nivel < 30
  ), todos as (
    select id, nivel from tras union select id, nivel from frente
  )
  select d.id, d.nosso_numero, d.nosso_numero_corp, d.tipo_corp, d.situacao, d.vigencia_inicio, d.vigencia_fim, d.numero_apolice, t.nivel
  from todos t join erp_documentos d on d.id = t.id
  order by t.nivel, d.vigencia_inicio
$$;
grant execute on function erp_familia_documento(uuid) to authenticated;

create index if not exists erp_documentos_renovado_idx on erp_documentos(documento_renovado_id);
create index if not exists erp_documentos_imob_seg_vigfim_idx on erp_documentos(imobiliaria_principal_id, seguradora_id, vigencia_fim);

-- 2ª passada: documentos em emissão/sem cliente ligado (ex.: 133629 da Lia Mara, digitado sem apólice):
-- liga quando há UM único candidato com mesma imobiliária, mesma seguradora, mesmo produto e
-- vigência encostada (até 3 dias). O cliente chega depois pelo casamento com o card/PDF.
create or replace function erp_ligar_renovacoes_legado_sem_cliente()
returns table (ligadas int)
language plpgsql security definer set search_path = public as $$
declare v_lig int;
begin
  alter table erp_documentos disable trigger erp_documentos_aud;
  create temp table _ren2 on commit drop as
  select d.id,
    (select array_agg(d2.id) from erp_documentos d2 join erp_ramos r2 on r2.id = d2.ramo_id
      where d2.id <> d.id and d2.tipo = 'A' and d2.tipo_corp <> 'CANC' and r2.produto = r.produto
        and d2.imobiliaria_principal_id = d.imobiliaria_principal_id and d2.seguradora_id = d.seguradora_id
        and d2.vigencia_fim between d.vigencia_inicio - 3 and d.vigencia_inicio + 3
        and not exists (select 1 from erp_documentos d3 where d3.documento_renovado_id = d2.id)) as candidatos
  from erp_documentos d join erp_ramos r on r.id = d.ramo_id
  where d.origem = 'corp_import' and d.tipo = 'A' and d.tipo_corp = 'RENV' and d.documento_renovado_id is null
    and d.locatario_id is null and d.imobiliaria_principal_id is not null and d.vigencia_inicio is not null;
  update erp_documentos d set documento_renovado_id = x.candidatos[1] from _ren2 x where x.id = d.id and array_length(x.candidatos, 1) = 1;
  get diagnostics v_lig = row_count;
  alter table erp_documentos enable trigger erp_documentos_aud;
  return query select v_lig;
end $$;
revoke all on function erp_ligar_renovacoes_legado_sem_cliente() from public;
-- select * from erp_ligar_renovacoes_legado_sem_cliente();
