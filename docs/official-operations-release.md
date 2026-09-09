# Integração das jornadas e operações oficiais — 2026-09-09

Esta entrega implementa a continuação autorizada após a auditoria das jornadas. A função de entrada continua sendo somente `support-runtime-inbound`. O painel usa os comandos autenticados dessa função para resolver pendências, conferir documentos e retomar a coleta preservando os casos.

## Comportamento

- Contexto em espera, respostas curtas, correções, pedidos de atendimento humano e perguntas paralelas preservam o caso correto.
- Recadastro coletado aguarda verificação humana; valores pendentes não satisfazem autorização. Casos diferentes não compartilham decisões.
- Perguntas informativas usam o catálogo oficial embarcado. Fontes sem aprovação/vigência, inclusive tarifas ainda sem mapeamento, continuam bloqueadas.
- Solicitações do domínio são materializadas na tabela existente, com protocolo real anunciado na próxima resposta entregue. Isso não significa autorização ou execução do serviço.
- Conferência documental é separada de decisão administrativa. Operador e decisão são auditados, com idempotência, versão do estado e versão do controle humano.
- Pausa humana posterior ao processamento prevalece. Respostas de revisão antiga são canceladas antes de uma nova tentativa de entrega.

## Implantação

1. Publicar o código revisado na main.
2. Aplicar **somente** `20260909193802_official_operations_bridge.sql`. Não executar instalação geral nem reaplicar 22–26. O nome remoto da migração identifica este arquivo; registrar a versão realmente atribuída pelo Supabase.
3. Publicar a função oficial com todas as dependências relativas e autenticação de entrada existente.
4. Executar a RPC existente `support_runtime_upgrade_catalog` uma única vez, do hash realmente ativo para o hash gerado desta versão, após conferir compatibilidade dos estados presentes.
5. Publicar o painel correspondente. Manter o canário exclusivo do número autorizado, sem mudança de segredos ou expansão automática.

## Validação e limites

Gates: testes de domínio/conversa/adaptação, testes PostgreSQL isolados do commit/outbox/operações, conformidade Python–TypeScript, lint/tipos/formato, manifesto e catálogos gerados. PGlite testa transações isoladas; não equivale a concorrência de múltiplas conexões em produção.

O aceite documental e as decisões precisam de verificação real por atendente autorizado. Não gerar aprovações fictícias para testar o ambiente real. A confirmação no WhatsApp e a interface autenticada devem ser registradas separadamente dos testes locais.

O evento manual digitado diretamente no aplicativo WhatsApp ainda precisa de confirmação do formato real que distingue humano de eco da API. O envio pelo painel pausa a automação; não reativar a função legada para tratar o evento externo.
