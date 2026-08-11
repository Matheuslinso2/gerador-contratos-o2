# Integração Google Forms - Capitalização

Fluxo independente da integração terceirizada do Seguro Fiança:

1. o Google Form grava a resposta na planilha vinculada;
2. um acionador da planilha envia a resposta para a API do Workspace O2;
3. a API valida o token, impede duplicidade e cria o card na SPA `Título de Capitalização`;
4. o resultado é registrado em `integracao_formularios_log`, quando a tabela de auditoria estiver instalada.

## Configuração

- Variável local/Vercel: `GOOGLE_FORMS_CAPITALIZACAO_SECRET`.
- Endpoint: `/api/integracoes/google-forms/capitalizacao`.
- Código da planilha: `capitalizacao.gs`.
- SQL de auditoria: `supabase/schema_integracao_formularios.sql`.

Na planilha de respostas, abra **Extensões > Apps Script**, mantenha o código deste diretório e execute uma única vez `configurarIntegracaoCapitalizacao`. Informe a URL completa do endpoint e o mesmo token configurado na Vercel. A função cria um único acionador `Ao enviar formulário` e remove acionadores anteriores da mesma função.

## Regras importantes

- O identificador da resposta é um hash dos valores enviados e do ID da aba. Repetições do mesmo evento não criam outro card.
- Colunas antigas mantidas pelo Google são ignoradas pelo mapa explícito de colunas.
- Valor de aluguel não é enviado ao CRM.
- Prêmio e rendas são enviados como campos monetários em BRL.
- A forma de pagamento só é preenchida quando a resposta informa claramente `Cartão` ou `Boleto`; a integração não deduz essa informação.
