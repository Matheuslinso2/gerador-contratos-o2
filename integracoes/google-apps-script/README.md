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

## Planilha de conferência — Ficha Fiança, Capitalização e RC Obras

Direção **oposta** às integrações acima: aqui é a Plataforma O2 (landing pages `/ficha-fianca`, `/capitalizacao` e `/rc-obras`) que empurra uma linha pra dentro de uma planilha do Google, a cada envio — não a planilha que aciona a Plataforma O2.

- O Google Forms "Ficha Fiança 5G" (e a planilha de respostas dele) **continua ativo e intocado** — essa planilha de conferência é separada de propósito (ver decisão registrada no código: escrever na planilha do Forms original arriscaria descolar as colunas se alguém editar o Forms no futuro).
- **Uma única planilha, uma única implantação do Apps Script, atendendo os três formulários** — cada envio diz de qual formulário é (campo `formulario: "ficha_fianca" | "capitalizacao" | "rc_obras"` no corpo) e cai na aba certa ("Respostas", "Capitalização" ou "RC Obras"), criada automaticamente no primeiro envio. Pra adicionar um formulário novo no futuro, só acrescentar uma entrada em `CONFIG` no `.gs` — não precisa de planilha nem implantação novas.
- Código da planilha: `ficha-fianca-planilha.gs`.
- Lado Next.js: `src/lib/integracoes/planilhaSeguroFianca.ts` (Ficha Fiança), `src/lib/integracoes/planilhaCapitalizacao.ts` (Capitalização) e `src/lib/integracoes/planilhaRcObras.ts` (RC Obras). Fiança/Capitalização chamam depois que o card já foi criado no Bitrix; **RC Obras não tem card** (SPA ainda não existe) — chama depois que o e-mail pra incendio@o2seguros.com.br já foi enviado. Nos três casos, falha na planilha nunca derruba o envio.
- Variáveis de ambiente (local/Vercel), **compartilhadas pelos dois formulários**: `GOOGLE_SHEETS_FICHA_FIANCA_URL` (URL do App da Web) e `GOOGLE_SHEETS_FICHA_FIANCA_SECRET` (mesmo texto do `TOKEN_ESPERADO` no `.gs`).

### Configuração (uma vez só)

1. Crie uma planilha nova em branco no Google Sheets (ex: "Landing Pages O2 — Conferência").
2. Extensões > Apps Script, apague o conteúdo padrão e cole `ficha-fianca-planilha.gs` inteiro.
3. Troque `TOKEN_ESPERADO` por um texto secreto longo e aleatório.
4. Implantar > Nova implantação > tipo "App da Web". Executar como "Eu", quem pode acessar "Qualquer pessoa". Autorize quando pedir — **precisa ser feito no navegador normal, não funciona em navegador automatizado** (mesma limitação já documentada na integração de Capitalização via Forms).
5. Copie a URL do App da Web gerada.
6. Cadastre `GOOGLE_SHEETS_FICHA_FIANCA_URL` (a URL) e `GOOGLE_SHEETS_FICHA_FIANCA_SECRET` (o mesmo token do passo 3) no `.env.local` e na Vercel (Production) — servem pros dois formulários, não precisa duplicar variável.
7. Se editar o `.gs` depois (ex: adicionar um formulário novo em `CONFIG`), use "Gerenciar implantações > Editar > nova versão" em vez de "Nova implantação", pra manter a mesma URL (senão as variáveis de ambiente precisam ser atualizadas de novo).
