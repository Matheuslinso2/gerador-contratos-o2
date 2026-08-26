-- Tabela de "Adicionar a Pendentes" do painel de Gestão de E-mails: mantém
-- um e-mail sinalizado na lista de Alertas até segunda ordem, mesmo que a
-- classificação por IA numa leitura futura da caixa não o marque mais como
-- relevante. Só o próprio Matheus (dono da caixa impersonada via delegação
-- de domínio) pode ler/gravar aqui -- dado pessoal de triagem, não da
-- corretora em geral.
--
-- Aplicado via MCP do Supabase em 2026-08-26 (projeto gerador-contratos-o2).
create table public.gestao_emails_pendentes (
  message_id text primary key,
  criado_em timestamptz not null default now()
);

alter table public.gestao_emails_pendentes enable row level security;

create policy "so_matheus_gestao_emails_pendentes"
  on public.gestao_emails_pendentes
  for all
  to authenticated
  using ((auth.jwt() ->> 'email') = 'matheus@o2seguros.com.br')
  with check ((auth.jwt() ->> 'email') = 'matheus@o2seguros.com.br');
