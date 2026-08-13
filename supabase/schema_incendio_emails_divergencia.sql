-- Ajuste na verificação de status por e-mail de Ramos Elementares.
--
-- Até aqui, toda "divergência" (e-mail não bate com a planilha) recebia o
-- mesmo peso -- mas na prática a maioria dos casos "não encontrado na
-- planilha" são e-mails de LOTE (uma imobiliária inteira renovada de uma
-- vez, com várias apólices numa mensagem só), que nunca vão casar com uma
-- única linha e não representam uma inconsistência real. O caso que
-- realmente importa é quando a linha FOI encontrada mas o status nela não
-- bate com o que o e-mail confirma -- isso sim é sinal de que a planilha
-- está desatualizada em relação ao que já aconteceu de verdade.
--
-- divergencia_tipo separa os dois casos pra tela poder tratar cada um com
-- o peso certo. e_lote marca e-mails que a IA identificou como cobrindo
-- várias apólices/clientes de uma vez -- esses não passam mais pela
-- tentativa de casar com uma linha da planilha (ver rota
-- /api/integracoes/incendio-email).

alter table incendio_emails_confirmacao
  add column if not exists divergencia_tipo text
  check (divergencia_tipo in ('nao_encontrado', 'status_desatualizado'));

alter table incendio_emails_confirmacao
  add column if not exists e_lote boolean not null default false;

-- Preenche divergencia_tipo pras linhas já processadas antes deste ajuste
-- (senão as ~16 divergências reais já encontradas na base ficariam
-- "invisíveis" pro painel até um novo e-mail repetir o mesmo caso).
update incendio_emails_confirmacao
set divergencia_tipo = case
  when divergencia_motivo like 'Nenhuma linha%' then 'nao_encontrado'
  else 'status_desatualizado'
end
where divergencia = true and divergencia_tipo is null;
