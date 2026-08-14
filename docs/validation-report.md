# Validação local do pacote

Data de geração: 2026-08-14. Nenhuma migration, RPC, trigger ou função foi executada/publicada.

## Verificações realizadas

- Estrutura obrigatória de diretórios e arquivos criada.
- Varredura de runtime: nenhum uso de `service_*`, `support-flow-context`, `support-rules-context`, `support-hybrid-router` ou `MODEL_RATIONALE` em `contracts/` e `edge-functions/`.
- Varredura de saída externa: `fetch` existe somente no cliente REST Supabase e no adaptador genérico de modelo; não existe cliente/call de W-API.
- Varredura de estado: `CLOSED` existe somente no estado de sessão, não em `automation_mode`.
- Harness local com Node 24 em modo TypeScript-strip executou 26 cenários, todos aprovados. O pacote também contém configuração Deno para a execução oficial posterior.

## Cobertura incluída

- release vigente, pinagem e revogação;
- estado antes de `sim`, tópico novo e lote de mensagens;
- ambiguidade/A_CONFIRMAR e ausência de fallback legado;
- templates, campos autorizados e proteção contra fato inventado pelo modelo;
- proposta, confirmação explícita, duplicidade de `sim`, nonce e conflito de tópico;
- Reclamação sem gravidade/setor/Ouvidoria/e-mail;
- humano ativo, inatividade sem W-API e comparação shadow sem efeito operacional;
- logs redigidos e feature flag global.

## Não verificado nesta fase

- execução real de SQL em PostgreSQL/Supabase isolado;
- RLS efetiva, grants e `pgcrypto` no projeto de destino;
- lock real de duas conexões PostgreSQL;
- integração n8n, W-API, Gemini ou função de agendamento;
- conteúdo factual de uma release oficial.

Esses itens pertencem à revisão 5B.2 e ao ambiente isolado posterior.
