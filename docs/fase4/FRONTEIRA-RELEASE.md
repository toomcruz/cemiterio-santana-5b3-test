# Fronteira do `release_id` — Fase 4A

```
NATUREZA      DOCUMENTACAO + GUARDA. Nao e implementacao de dominio.
BASE          docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md
RELEASE_ATUAL exu-1.0-32cc48f26797
SUBFASE       4A
BASE_MAIN     d2cabdf4b51dfe62909a90445b6b9230884d810d
```

## O que e a fronteira

O `release_id` e derivado do **conteudo** concatenado, nesta ordem:

1. `santana-authority/catalogo/exumacao.v1.json`
2. os cinco arquivos em `ARQUIVOS_DE_DOMINIO` (ordem alfabetica fixa):
   - `facts.v1.json`
   - `goals.v1.json`
   - `questions.v1.json`
   - `relations.v1.json`
   - `topics.v1.json`

Definicao operacional (TS): `santana-authority-gateway/catalogo/carregar.ts`.

```
release_id = "exu-" + schema_version + "-" + sha256(catalogo ‖ dominio...)[0:12]
```

Qualquer byte alterado **dentro** dessa concatenacao muda o `release_id` e
torna `INVALIDO` cada um dos 47 casos V1–V12.

## Dentro da fronteira

Tocar estes arquivos **obriga** bump de `release_id` e reconformidade:

- `santana-authority/catalogo/exumacao.v1.json`
- `santana-conversation-domain/facts.v1.json`
- `santana-conversation-domain/goals.v1.json`
- `santana-conversation-domain/questions.v1.json`
- `santana-conversation-domain/relations.v1.json`
- `santana-conversation-domain/topics.v1.json`

## Fora da fronteira

Podem evoluir **sem** mudar o `release_id`:

- `santana-conversation-domain/state.schema.json`
- `santana-conversation-domain/conversation-events.v1.json`
- `santana-conversation-domain/engine/**`
- `santana-conversation-domain/runtime/**`
- `santana-authority-gateway/**` (leitor, nao dono do conhecimento)
- `referencia/**`
- `conformidade/perfis/**`
- `docs/**`

Consequencia para a Fase 4: as subfases **4B–4F** trabalham fora da fronteira.
As mudancas de conhecimento ficam agrupadas em **4G–4I**, com **um unico bump**
de `release_id` no fim.

```
UM BUMP, NO FIM.  NAO SEIS BUMPS PELO CAMINHO.
```

## Guardas (T27)

Em `santana-authority-gateway/tests/garantias_test.ts`:

1. o `release_id` recalculado continua `exu-1.0-32cc48f26797`;
2. `ARQUIVOS_DE_DOMINIO` permanece com tamanho 5 e ordem alfabetica fixa;
3. `state.schema.json` e `conversation-events.v1.json` **nao** entram no digest
   — prova de que 4B–4F podem evoluir sem reconformidade.

## Mudancas proibidas nesta subfase

- tocar qualquer arquivo da fronteira;
- tocar `gateway.ts`, `consulta.ts`, `resposta.ts`;
- tocar vetores de conformidade;
- conectar Supabase, n8n, W-API ou WhatsApp;
- alterar Lab C1 (`experiments/c1-omniroute/**`).
