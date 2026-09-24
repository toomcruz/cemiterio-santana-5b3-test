# Gate 3 — ponte HTTP canônica LAB

**Branch:** `sana-lab-exumacao-f0-f2`; base `b142578163e7a5d552057e38c2a8fd92ba3881ab`.
**Bridge version:** `sana-lab-bridge/1`. **Engine:** `sana-lab/engine.ts`; catálogo: `santana-authority/catalogo/exumacao.v1.json`, release `exu-1.0-be0300053f95`. A bridge importa `handle` diretamente e não contém regras de serviço. O `FileStore` existente isola o estado em diretório LAB com revisão e lock por caso.

## Contrato

`POST /lab/v1/turn` com `Authorization: Bearer <token LAB>` e JSON:

```json
{
  "contract_version": "sana-lab-bridge/1",
  "event_id": "a",
  "case_id": "case-a",
  "conversation_id": "conv-case-a",
  "episode_id": "ep-case-a",
  "correlation_id": "corr-a",
  "message": "Quero exumar meu pai",
  "layer1_result": { "familia": "EXUMACAO", "objetivo": "INICIAR_SERVICO", "tipo_turno": "DEMANDA", "referencia": "meu pai" },
  "previous_revision": 0,
  "document_references": []
}
```

`previous_revision` pode ser omitida na leitura inicial; se fornecida e divergente, HTTP 409 sem escrita. A saída 200 contém `contract_version`, `case_id`, `previous_revision`, `new_revision`, `module`, `decision`, `authority_status`, `state`, `response`, `operations`, `duplicate` e `evidence` com IDs, fontes e caminho do engine. Operações são marcadas `simulated: true`. Sem autenticação: 401; contrato inválido: 422; revisão conflitante: 409; falha essencial: 503, sem resposta alternativa.

## Execução local isolada

A bridge só aceita `127.0.0.1`. Exige `SANA_LAB_TOKEN` (mínimo 32 caracteres) e `SANA_LAB_STATE_DIR` absoluto. Uma exposição futura a outro container requer rota privada autenticada adicional, com TLS e limitação ao n8n LAB. Não abrir webhook público nem usar token em nó de texto ou arquivo versionado.

```sh
SANA_LAB_TOKEN="<token-LAB-injetado-fora-do-repositório>" \
SANA_LAB_STATE_DIR="<diretório-absoluto-exclusivo-LAB>" \
deno run --allow-read --allow-write --allow-net=127.0.0.1 \
  --allow-env=SANA_LAB_TOKEN,SANA_LAB_STATE_DIR,SANA_LAB_PORT,SANTANA_CATALOGO_OFICIAL,SANTANA_REPO_ROOT,SANTANA_PERFIL_EXUMACAO \
  sana-lab/bridge.ts
```

O comando acima é documentação, não declaração de serviço implantado. Nenhum token foi criado ou persistido nesta branch.

## Evidências e estado do gate

Testes Deno de `sana-lab/tests`: A–F pela bridge, isolamento, replay, revisão, corrida concorrente, autorização Bearer, contrato inválido, indisponibilidade do armazenamento, conexão encerrada, timeout e listener HTTP loopback. **13/13 PASS** no ambiente local; nenhuma chamada Gemini, W-API, WhatsApp ou escrita oficial. A falha de conexão/timeout é teste do cliente Deno; a verificação correspondente no n8n ainda não foi executada.

Workflow LAB n8n `m6y2AD8Vx1QZaJiE` continua manual, inativo e com `gate=BLOCKED`. Não foi atualizado com HTTP Request porque não existe endereço privado alcançável pelo n8n nem credencial LAB instalada. A versão anterior `10c5389a-8833-4946-b916-57248f508579` executou somente o contrato sintético (`10163`), não o engine. O canário `qxEGiuRNYEOT8smE` permanece intocado.

**GATE = BLOCKED.** Para avançar, implantar o mesmo commit num runtime Deno LAB que o n8n possa alcançar por rota privada, fornecer o token apenas via gerenciador de credenciais, configurar timeout e validação rígida da resposta no workflow LAB, e executar A–F com `N8N_EXECUTION_ID` por turno. Nenhum fallback de negócio no n8n. Não iniciar Recadastro nem Gemini pago.
