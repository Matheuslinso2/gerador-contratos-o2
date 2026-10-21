-- Visão 360 da imobiliária (Matheus, 21/10/2026): aba "Imobiliária 360" em
-- Power BI - O2 Seguros (/producao/imobiliaria). Escolhe-se um grupo (soma de
-- todas as fichas, com a quebra por unidade) ou uma ficha, e o período.
-- Cotações e apólices por produto vêm de kpis_producao (mesma régua do
-- Power BI); esta função junta o resto do comportamento da imobiliária:
--   * cadastro: fichas, grupo, logins no portal, desde quando produz (Corp);
--   * por unidade: cotações, apólices, sinistros e uso das ferramentas;
--   * sinistros: mesma base do dashboard de Sinistros (sinistros_kpi_fato —
--     histórico do Corp sem card + cards do Workspace), ligada à FICHA pela
--     apólice (Nosso Nº no Corp → produtor confirmado) ou pelo card;
--   * ferramentas: Auditor de contrato, Gerador de contrato, Faturas e
--     Campanhas (envios/aberturas/cliques). Cálculo de multa rescisória não
--     registra a imobiliária (fica de fora, avisado na tela).
-- Só lê tabelas pequenas ou o resumo mensal (producao_painel_mensal), nada de
-- releitura da base inteira (regra "mês fechado congela").

create or replace function visao_360_imobiliaria(p_tipo text, p_id uuid, p_de text, p_ate text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_imobs uuid[];
  v_chave text;
  r jsonb;
begin
  if not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  if p_tipo = 'grupo' then
    select coalesce(array_agg(id), '{}') into v_imobs from imobiliarias where grupo_id = p_id;
  else
    v_imobs := array[p_id];
  end if;
  -- Chave da aba Sinistros: grupo da ficha > ficha.
  v_chave := case when p_tipo = 'grupo' then 'g:' || p_id::text
                  else (select coalesce('g:' || grupo_id::text, 'i:' || id::text) from imobiliarias where id = p_id) end;

  with
  meses as (
    select to_char(m, 'YYYY-MM') competencia
    from generate_series(to_date(p_de, 'YYYY-MM'), to_date(p_ate, 'YYYY-MM'), interval '1 month') m
  ),
  fichas as (
    select i.* from imobiliarias i where i.id = any(v_imobs)
  ),
  -- Sinistros: os mesmos da aba Sinistros (sinistros_kpi_fato já diz o grupo
  -- ou a ficha de cada um — mesma regra, mesmos totais). Só esses poucos são
  -- resolvidos até a FICHA, para a quebra por unidade: card → ficha do card;
  -- Corp → apólice (Nosso Nº, índice único) → produtor → ficha (texto igual à
  -- chave do registro vence o nome, como em producao_resolvida).
  cand as (
    select f.* from sinistros_kpi_fato f where f.grupo_chave = v_chave
  ),
  cand_texto as (
    select c.id, s.imobiliaria_id as imob_card, s.id as card, p.imobiliaria_texto as texto
    from cand c
    left join sinistros s on c.origem = 'workspace' and s.id = c.id
    left join sinistros_corp sc on sc.id = case when c.origem = 'corp' then c.id else s.sinistro_corp_id end
    left join producao_unificada p on p.fonte = 'corp' and p.origem_corp_numero = sc.nosso_numero
      and p.produto = case when coalesce(sc.produto, 'fianca') in ('fianca', 'capitalizacao', 'automovel') then coalesce(sc.produto, 'fianca') else 're' end
  ),
  nome_imob as (
    select distinct on (texto) texto, imobiliaria_id from (
      select r.chave_externa texto, r.imobiliaria_id, 0 pri from imobiliaria_registros_fonte r
      where r.fonte = 'corp_produtor' and r.situacao = 'confirmado' and r.chave_externa in (select texto from cand_texto)
      union all
      select r.nome_original, r.imobiliaria_id, 1 from imobiliaria_registros_fonte r
      where r.fonte = 'corp_produtor' and r.situacao = 'confirmado' and r.nome_original in (select texto from cand_texto)
    ) x order by texto, pri
  ),
  sin_todos as (
    select c.*, case when cardinality(v_imobs) = 1 and p_tipo <> 'grupo' and v_chave like 'i:%' then v_imobs[1]
                     else coalesce(t.imob_card, n.imobiliaria_id) end as imob,
           t.card
    from cand c
    join cand_texto t on t.id = c.id
    left join nome_imob n on n.texto = t.texto
  ),
  -- Ficha avulsa / grupo: todos os do grupo. Unidade de um grupo: só os dela.
  sin as (
    select * from sin_todos where p_tipo = 'grupo' or v_chave like 'i:%' or imob = any(v_imobs)
  ),
  sin_per as (select * from sin where to_char(dt_aviso, 'YYYY-MM') between p_de and p_ate),
  aud as (
    select a.imobiliaria_id imob, to_char(a.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM') competencia, a.created_at, a.status_geral
    from auditorias_contrato a where a.imobiliaria_id = any(v_imobs)
  ),
  ger as (
    select c.imobiliaria_id imob, to_char(c.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM') competencia, c.created_at
    from contratos c where c.imobiliaria_id = any(v_imobs)
  ),
  fat as (
    select f.imobiliaria_id imob, to_char(f.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM') competencia, f.created_at
    from faturas f where f.imobiliaria_id = any(v_imobs)
  ),
  camp as (
    select e.imobiliaria_id imob, to_char(e.enviado_em at time zone 'America/Sao_Paulo', 'YYYY-MM') competencia, e.enviado_em, e.aberto_em, e.clicado_em, e.campanha_id
    from campanhas_envios e where e.imobiliaria_id = any(v_imobs) and e.enviado_em is not null
  ),
  painel as (
    select m.* from producao_painel_mensal m where m.imobiliaria_id = any(v_imobs)
  ),
  por_unidade as (
    select f.id, coalesce(nullif(f.apelido, ''), f.nome) nome, f.nome nome_completo, f.papel_no_grupo, f.cnpj, f.cidade, f.uf,
           f.cadastro_incompleto, f.codigo_produtor_corp, f.origem_comercial, f.created_at::date cadastrada_em,
           (select count(*) from imobiliaria_membros mb where mb.imobiliaria_id = f.id) + (case when f.user_id is not null then 1 else 0 end) logins,
           (select min(competencia) from painel p where p.imobiliaria_id = f.id and p.origem = 'producao') produz_desde,
           (select max(competencia) from painel p where p.imobiliaria_id = f.id and p.origem = 'producao') ultima_apolice,
           (select max(competencia) from painel p where p.imobiliaria_id = f.id and p.origem = 'funil' and p.evento = 'entrada') ultima_cotacao,
           coalesce((select sum(n) from painel p where p.imobiliaria_id = f.id and p.origem = 'funil' and p.evento = 'entrada' and p.competencia between p_de and p_ate), 0) cotacoes,
           coalesce((select sum(n) from painel p where p.imobiliaria_id = f.id and p.origem = 'funil' and p.evento = 'conversao' and p.competencia between p_de and p_ate), 0) convertidas,
           coalesce((select sum(n) from painel p where p.imobiliaria_id = f.id and p.origem = 'producao' and p.competencia between p_de and p_ate), 0) apolices,
           coalesce((select sum(premio) from painel p where p.imobiliaria_id = f.id and p.origem = 'producao' and p.competencia between p_de and p_ate), 0) premio,
           coalesce((select sum(comissao) from painel p where p.imobiliaria_id = f.id and p.origem = 'producao' and p.competencia between p_de and p_ate), 0) comissao,
           (select count(*) from sin_per s where s.imob = f.id) sinistros,
           coalesce((select sum(vl_indenizado) from sin_per s where s.imob = f.id), 0) indenizado,
           (select count(*) from sin s where s.imob = f.id and s.situacao = 'EM ANDAMENTO') sinistros_abertos,
           (select count(*) from aud a where a.imob = f.id and a.competencia between p_de and p_ate) auditorias,
           (select count(*) from ger g where g.imob = f.id and g.competencia between p_de and p_ate) contratos,
           (select count(*) from fat x where x.imob = f.id and x.competencia between p_de and p_ate) faturas,
           (select count(*) from camp c where c.imob = f.id and c.competencia between p_de and p_ate) campanhas_recebidas,
           (select count(*) from camp c where c.imob = f.id and c.competencia between p_de and p_ate and c.aberto_em is not null) campanhas_abertas
    from fichas f
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'alvo', case when p_tipo = 'grupo' then
        (select jsonb_build_object('tipo', 'grupo', 'id', g.id, 'nome', g.nome, 'tipo_grupo', g.tipo) from imobiliaria_grupos g where g.id = p_id)
      else
        (select jsonb_build_object('tipo', 'imobiliaria', 'id', i.id, 'nome', coalesce(nullif(i.apelido, ''), i.nome),
                                   'grupo', (select jsonb_build_object('id', g.id, 'nome', g.nome, 'tipo_grupo', g.tipo) from imobiliaria_grupos g where g.id = i.grupo_id))
         from imobiliarias i where i.id = p_id)
      end,
    'unidades', coalesce((select jsonb_agg(to_jsonb(u) order by u.premio desc, u.cotacoes desc, u.nome) from por_unidade u), '[]'),
    'fontes', coalesce((select jsonb_agg(jsonb_build_object('fonte', fonte, 'nomes', n) order by n desc)
                        from (select r.fonte, count(*) n from imobiliaria_registros_fonte r
                              where r.imobiliaria_id = any(v_imobs) and r.situacao = 'confirmado' group by r.fonte) x), '[]'),
    'sinistros', jsonb_build_object(
      'avisados', (select count(*) from sin_per),
      'vl_avisado', coalesce((select sum(vl_avisado) from sin_per), 0),
      'indenizados', (select count(*) from sin_per where situacao = 'INDENIZADO'),
      'vl_indenizado', coalesce((select sum(vl_indenizado) from sin_per), 0),
      'sem_indenizacao', (select count(*) from sin_per where situacao = 'ENCERRADO SEM INDENIZAÇÃO'),
      'em_andamento', (select count(*) from sin where situacao = 'EM ANDAMENTO'),
      'total_historico', (select count(*) from sin),
      'desde', (select min(dt_aviso) from sin),
      'por_produto', coalesce((select jsonb_object_agg(produto, n) from (select coalesce(produto, 'outros') produto, count(*) n from sin_per group by 1) x), '{}'),
      'abertos', coalesce((select jsonb_agg(jsonb_build_object('card', s.card, 'produto', s.produto, 'tipo', s.tipo_sinistro, 'seguradora', s.seguradora,
                                                               'aviso', s.dt_aviso, 'vl_avisado', s.vl_avisado,
                                                               'unidade', (select coalesce(nullif(f.apelido, ''), f.nome) from fichas f where f.id = s.imob))
                                            order by s.dt_aviso desc)
                           from sin s where s.situacao = 'EM ANDAMENTO'), '[]')
    ),
    'ferramentas', jsonb_build_object(
      'auditor', jsonb_build_object('periodo', (select count(*) from aud where competencia between p_de and p_ate), 'total', (select count(*) from aud),
                                    'ultima', (select max(created_at) from aud),
                                    'por_status', coalesce((select jsonb_object_agg(coalesce(status_geral, '—'), n) from (select status_geral, count(*) n from aud where competencia between p_de and p_ate group by 1) x), '{}')),
      'gerador', jsonb_build_object('periodo', (select count(*) from ger where competencia between p_de and p_ate), 'total', (select count(*) from ger), 'ultima', (select max(created_at) from ger)),
      'faturas', jsonb_build_object('periodo', (select count(*) from fat where competencia between p_de and p_ate), 'total', (select count(*) from fat), 'ultima', (select max(created_at) from fat)),
      'campanhas', jsonb_build_object('recebidas', (select count(*) from camp where competencia between p_de and p_ate),
                                      'abertas', (select count(*) from camp where competencia between p_de and p_ate and aberto_em is not null),
                                      'clicadas', (select count(*) from camp where competencia between p_de and p_ate and clicado_em is not null),
                                      'campanhas', (select count(distinct campanha_id) from camp where competencia between p_de and p_ate),
                                      'ultima', (select max(enviado_em) from camp)),
      'logins', (select coalesce(sum(logins), 0) from por_unidade)
    ),
    'mensal', coalesce((select jsonb_agg(jsonb_build_object(
        'competencia', m.competencia,
        'sinistros', (select count(*) from sin s where to_char(s.dt_aviso, 'YYYY-MM') = m.competencia),
        'auditorias', (select count(*) from aud a where a.competencia = m.competencia),
        'contratos', (select count(*) from ger g where g.competencia = m.competencia),
        'faturas', (select count(*) from fat x where x.competencia = m.competencia),
        'campanhas_abertas', (select count(*) from camp c where c.competencia = m.competencia and c.aberto_em is not null)
      ) order by m.competencia) from meses m), '[]')
  ) into r;
  return r;
end;
$$;
revoke all on function visao_360_imobiliaria(text, uuid, text, text) from public, anon;
grant execute on function visao_360_imobiliaria(text, uuid, text, text) to authenticated;
