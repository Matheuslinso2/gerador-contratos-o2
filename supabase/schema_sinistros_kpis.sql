-- KPIs de sinistro de Seguro Fiança (painel /sinistros/painel).
-- Plano: entregaveis/modulo-sinistro/KPIs Sinistro - Planejamento.pdf (v1.1).
--
-- Fontes:
--   - sinistros_corp: contagem e valores (o Setor de Garantias ainda lança
--     tudo no Corp; somar o módulo junto duplicaria);
--   - producao_unificada (fiança/Corp): apólice de cada sinistro pelo Nosso
--     Nº, apólices vigentes e PRÊMIO GANHO (decidido em 19/10/2026: parte do
--     prêmio de cada apólice correspondente aos meses vigentes na janela);
--   - imobiliaria_registros_fonte (corp_produtor confirmado) → imobiliarias →
--     imobiliaria_grupos: tudo somado pelo GRUPO quando houver;
--   - sinistros/sinistro_historico/sinistro_documentos: KPIs de processo do
--     módulo novo (prazo, retrabalho, recusas).
-- Janela padrão: 12 meses até p_ref. Só equipe O2. Aplicado via MCP.

create or replace function kpis_sinistros(p_ref date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  ini date := p_ref - interval '12 months';
  resultado jsonb;
begin
  if not is_colaborador_o2() then
    raise exception 'acesso restrito à equipe O2';
  end if;

  with
  vinc as (
    select distinct on (trim(nome_original)) trim(nome_original) nome, imobiliaria_id
    from imobiliaria_registros_fonte
    where fonte = 'corp_produtor' and situacao = 'confirmado' and imobiliaria_id is not null
    order by trim(nome_original), confirmado_em desc nulls last
  ),
  -- Agrupamento: grupo da imobiliária > imobiliária confirmada > texto do Corp.
  quem as (
    select t.texto,
      coalesce('g:' || g.id::text, 'i:' || i.id::text, 't:' || t.texto) chave,
      coalesce(g.nome, nullif(i.apelido, ''), i.nome, t.texto) nome,
      case when g.id is not null then 'grupo' when i.id is not null then 'imobiliaria' else 'sem_vinculo' end tipo
    from (select distinct trim(imobiliaria_texto) texto from producao_unificada where produto = 'fianca' and fonte = 'corp') t
    left join vinc v on v.nome = t.texto
    left join imobiliarias i on i.id = v.imobiliaria_id
    left join imobiliaria_grupos g on g.id = i.grupo_id
  ),
  apolices as (
    select p.origem_corp_numero nn, trim(p.imobiliaria_texto) texto, p.seguradora, p.premio,
      (p.extras ->> 'vigencia_inicio')::date vi, (p.extras ->> 'vigencia_fim')::date vf
    from producao_unificada p
    where p.produto = 'fianca' and p.fonte = 'corp'
  ),
  carteira as (
    select q.chave, a.seguradora,
      count(*) filter (where a.vi <= p_ref and a.vf >= p_ref) vigentes,
      sum(case when a.premio > 0 and a.vf > a.vi then
            a.premio / greatest((a.vf - a.vi) / 30.4, 1)
            * least(12, greatest(0, (least(a.vf, p_ref) - greatest(a.vi, ini::date)) / 30.4))
          else 0 end) premio_ganho
    from apolices a join quem q on q.texto = a.texto
    group by rollup (q.chave, a.seguradora)
  ),
  s as (
    select sc.*, coalesce(sc.dt_aviso, sc.dt_ocorrencia) dt_ref_aviso,
      coalesce(ap.seguradora, sc.seguradora) seg, q.chave grupo_chave, q.nome grupo_nome, q.tipo grupo_tipo
    from sinistros_corp sc
    -- Junta direto na tabela (usa o índice do nº do Corp); um CTE reaproveitado
    -- seria materializado sem índice e custava ~10 s.
    left join (
      select distinct on (origem_corp_numero) origem_corp_numero nn, trim(imobiliaria_texto) texto, seguradora
      from producao_unificada where produto = 'fianca' and fonte = 'corp'
      order by origem_corp_numero, data_efetivacao desc nulls last
    ) ap on ap.nn = sc.nosso_numero
    left join quem q on q.texto = ap.texto
  ),
  janela as (
    select s.*,
      (dt_ref_aviso > ini and dt_ref_aviso <= p_ref) avisado_12m,
      (situacao = 'INDENIZADO' and dt_encerramento > ini and dt_encerramento <= p_ref) indenizado_12m,
      (situacao = 'ENCERRADO SEM INDENIZAÇÃO' and dt_encerramento > ini and dt_encerramento <= p_ref) sem_ind_12m
    from s
  ),
  recorrencia as (
    select nosso_numero, count(*) n from s
    where dt_ref_aviso > p_ref - interval '24 months' and dt_ref_aviso <= p_ref
    group by 1
  ),
  total_carteira as (select vigentes, premio_ganho from carteira where chave is null and seguradora is null),
  resumo as (
    select jsonb_build_object(
      'avisados', count(*) filter (where avisado_12m),
      'avisados_ocupado', count(*) filter (where avisado_12m and tipo_sinistro = 'ocupado'),
      'avisados_chaves', count(*) filter (where avisado_12m and tipo_sinistro = 'chaves'),
      'vigentes', (select vigentes from total_carteira),
      'premio_ganho', round((select premio_ganho from total_carteira)),
      'indenizado', round(coalesce(sum(vl_indenizado) filter (where indenizado_12m), 0)),
      'avisado_valor', round(coalesce(sum(vl_avisado) filter (where avisado_12m), 0)),
      'encerrados_indenizados', count(*) filter (where indenizado_12m),
      'encerrados_sem_indenizacao', count(*) filter (where sem_ind_12m),
      'em_aberto', count(*) filter (where situacao in ('PENDENTE', 'EM ANDAMENTO')),
      'em_aberto_mais_90_dias', count(*) filter (where situacao in ('PENDENTE', 'EM ANDAMENTO') and dt_ref_aviso < p_ref - 90),
      'mediana_dias_ate_encerrar', (select percentile_cont(0.5) within group (order by dt_encerramento - dt_aviso)
                                    from janela where (indenizado_12m or sem_ind_12m) and dt_aviso is not null and dt_encerramento >= dt_aviso),
      'ticket_medio', round(coalesce(avg(vl_indenizado) filter (where indenizado_12m and vl_indenizado > 0), 0)),
      'contratos_com_sinistro_24m', (select count(*) from recorrencia),
      'contratos_recorrentes_24m', (select count(*) from recorrencia where n > 1)
    ) j from janela
  ),
  meses as (
    select generate_series(date_trunc('month', p_ref) - interval '23 months', date_trunc('month', p_ref), interval '1 month') m
  ),
  av_mes as (select date_trunc('month', dt_ref_aviso) m, count(*) n from s group by 1),
  enc_mes as (
    select date_trunc('month', dt_encerramento) m,
      count(*) filter (where situacao = 'INDENIZADO') ind,
      count(*) filter (where situacao = 'ENCERRADO SEM INDENIZAÇÃO') sem,
      sum(vl_indenizado) filter (where situacao = 'INDENIZADO') valor
    from s group by 1
  ),
  mensal as (
    select jsonb_agg(jsonb_build_object(
      'mes', to_char(meses.m, 'YYYY-MM'),
      'avisados', coalesce(av_mes.n, 0),
      'indenizados', coalesce(enc_mes.ind, 0),
      'sem_indenizacao', coalesce(enc_mes.sem, 0),
      'valor_indenizado', round(coalesce(enc_mes.valor, 0))
    ) order by meses.m) j
    from meses left join av_mes on av_mes.m = meses.m left join enc_mes on enc_mes.m = meses.m
  ),
  rec_grupo as (
    select s.grupo_chave, count(distinct s.nosso_numero) n
    from s join recorrencia r on r.nosso_numero = s.nosso_numero and r.n > 1
    group by 1
  ),
  por_seguradora as (
    select jsonb_agg(x order by (x ->> 'indenizado')::numeric desc) j from (
      select jsonb_build_object(
        'seguradora', seg,
        'avisados', count(*) filter (where avisado_12m),
        'indenizados', count(*) filter (where indenizado_12m),
        'sem_indenizacao', count(*) filter (where sem_ind_12m),
        'indenizado', round(coalesce(sum(vl_indenizado) filter (where indenizado_12m), 0)),
        'em_aberto', count(*) filter (where situacao in ('PENDENTE', 'EM ANDAMENTO')),
        'vigentes', (select sum(c.vigentes) from carteira c where c.chave is not null and c.seguradora = j2.seg),
        'premio_ganho', (select round(sum(c.premio_ganho)) from carteira c where c.chave is not null and c.seguradora = j2.seg)
      ) x
      from janela j2
      group by seg
      having count(*) filter (where avisado_12m or indenizado_12m or sem_ind_12m or situacao in ('PENDENTE', 'EM ANDAMENTO')) > 0
    ) t
  ),
  por_imobiliaria as (
    select jsonb_agg(x order by (x ->> 'indenizado')::numeric desc, (x ->> 'avisados')::int desc) j from (
      select jsonb_build_object(
        'chave', grupo_chave, 'nome', grupo_nome, 'tipo', grupo_tipo,
        'avisados', count(*) filter (where avisado_12m),
        'indenizados', count(*) filter (where indenizado_12m),
        'sem_indenizacao', count(*) filter (where sem_ind_12m),
        'indenizado', round(coalesce(sum(vl_indenizado) filter (where indenizado_12m), 0)),
        'em_aberto', count(*) filter (where situacao in ('PENDENTE', 'EM ANDAMENTO')),
        'recorrentes', coalesce((select rg.n from rec_grupo rg where rg.grupo_chave = janela.grupo_chave), 0),
        'vigentes', (select c.vigentes from carteira c where c.chave = janela.grupo_chave and c.seguradora is null),
        'premio_ganho', (select round(c.premio_ganho) from carteira c where c.chave = janela.grupo_chave and c.seguradora is null)
      ) x
      from janela
      where grupo_chave is not null
      group by grupo_chave, grupo_nome, grupo_tipo
      having count(*) filter (where avisado_12m or indenizado_12m or situacao in ('PENDENTE', 'EM ANDAMENTO')) > 0
    ) t
  ),
  -- Processo do módulo novo (só sinistros enviados pelo Workspace).
  mod as (
    select m.* from sinistros m
    where m.enviado_em is not null and m.etapa <> 'cancelado' and m.enviado_em::date > ini
  ),
  processo as (
    select jsonb_build_object(
      'enviados', (select count(*) from mod),
      'no_prazo', (select count(*) from mod where not aviso_fora_prazo),
      'com_pendencia', (select count(distinct h.sinistro_id) from sinistro_historico h join mod on mod.id = h.sinistro_id where h.etapa_para = 'pendencia_imobiliaria'),
      'devolucoes', (select count(*) from sinistro_historico h join mod on mod.id = h.sinistro_id where h.etapa_para = 'pendencia_imobiliaria'),
      'abertos_na_seguradora', (select count(*) from mod where numero_sinistro_seguradora is not null),
      'mediana_dias_ate_abrir', (select percentile_cont(0.5) within group (order by data_abertura_seguradora - enviado_em::date) from mod where data_abertura_seguradora is not null),
      'motivos_recusa', (select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'n', n) order by n desc), '[]'::jsonb) from (
          select split_part(d.motivo_recusa, ' — ', 1) motivo, count(*) n
          from sinistro_documentos d join mod on mod.id = d.sinistro_id
          where d.motivo_recusa is not null group by 1 order by 2 desc limit 6) mr)
    ) j
  )
  select jsonb_build_object(
    'referencia', p_ref,
    'inicio_janela', ini::date,
    'importado_em', (select max(atualizado_em) from sinistros_corp),
    'resumo', (select j from resumo),
    'mensal', (select j from mensal),
    'por_seguradora', coalesce((select j from por_seguradora), '[]'::jsonb),
    'por_imobiliaria', coalesce((select j from por_imobiliaria), '[]'::jsonb),
    'processo', (select j from processo)
  ) into resultado;

  return resultado;
end;
$$;

revoke execute on function kpis_sinistros(date) from anon, public;
grant execute on function kpis_sinistros(date) to authenticated;

-- Retrato do painel (mesma regra dos outros painéis, src/lib/retratoPaineis.ts):
-- a página usa o retrato se tiver até 10 min; senão recalcula (~2,5 s) e grava.
create table if not exists sinistros_kpis_retrato (
  id smallint primary key default 1 check (id = 1),
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table sinistros_kpis_retrato enable row level security;
drop policy if exists "sinistros_kpis_retrato o2" on sinistros_kpis_retrato;
create policy "sinistros_kpis_retrato o2" on sinistros_kpis_retrato for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
