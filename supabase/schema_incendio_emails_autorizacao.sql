-- Novo tipo de sinal em incendio_emails_confirmacao: "autorizacao_cliente" --
-- diferente dos outros 3 tipos (que são a PRÓPRIA O2 confirmando algo),
-- esse é o INVERSO: a imobiliária/cliente dando o aval ("pode seguir com a
-- contratação", "podem renovar") ANTES da O2 confirmar. Serve pra alertar
-- quando o cliente já autorizou e a O2 ainda não fechou o loop.

alter table incendio_emails_confirmacao drop constraint if exists incendio_emails_confirmacao_tipo_confirmacao_check;

alter table incendio_emails_confirmacao add constraint incendio_emails_confirmacao_tipo_confirmacao_check
  check (tipo_confirmacao in (
    'contratacao_confirmada', 'apolice_emitida', 'cancelamento_confirmado', 'autorizacao_cliente', 'outro', 'nao_identificado'
  ));
