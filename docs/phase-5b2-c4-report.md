# Fase 5B.2-C4 — correção cirúrgica local

## Escopo aplicado

- Corrigida a ordem do classificador: classificação antes de usar `output` em feature flags.
- Criada cadeia `inbound_messages → inbound_classifications → confirmation_authorizations → CONFIRM`.
- Removidas as assinaturas vNext antigas de confirmação e de persistência afirmativa derivada.
- Adicionadas guards de schema para DecisionPlan, proposal fields e fontes vinculadas a release final.
- Corrigida seleção de policy de inatividade por escopo/prioridade, com falha fechada para ambiguidade.
- Atualizados runners, CI, matriz de RPCs e rollbacks C4.

## Testes locais efetivamente executados

- `bash -n tests/postgres/run_all.sh tests/postgres/run_concurrency.sh tests/postgres/verify_static.sh` — PASS.
- `tests/postgres/verify_static.sh` — PASS: 15 arquivos P01–P15, cada qual com assert/erro esperado e sem marcador descritivo.

## Não executado

- SQL, migrations e P01–P15 dinâmicos: não executados.
- `deno fmt --check`, `deno lint`, `deno check`, `deno test`: **NÃO EXECUTADO — AMBIENTE SEM DENO**.
- Nenhuma conexão com Supabase, n8n, W-API, Gemini, V7.7 ou conhecimento legado.

## Limite de aprovação

Este pacote continua pendente de reauditoria estática independente. A execução real de concorrência, RLS/PostgREST e constraints é responsabilidade da 5B.3 em banco isolado, depois de reauditoria.
