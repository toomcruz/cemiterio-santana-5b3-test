# Componentes reaproveitados e mudanças

## Reaproveitados do sistema atual

- normalização e SHA-256 já testados no runtime;
- contrato e semântica de `processOfficialTurn` para o baseline atual;
- interpretador determinístico v1;
- reducer, validação de estado, revisão otimista e dedupe de inbound;
- projeção de estado e outbox do runtime atual;
- padrões já testados de fail-closed, catálogo e isolamento de casos;
- convenções de testes Deno e fixtures sintéticas.

O adapter atual executa o caminho automático seguro completo disponível no v1: entrada normalizada, interpretação,
contexto, reducer, persistência transacional em memória, outbox, resposta, auditoria e idempotência. Capacidades que o
v1 não possui de forma unificada — Action Gateway semântico, receipts e confirmação de aceite de handoff — são marcadas
como ausentes, nunca fabricadas.

## Componentes novos

- contratos versionados do Motor V2;
- provider multilabel com trust boundary fechado;
- provider determinístico de LAB;
- estados transversais, risco/confiança e complexidade;
- trilhas independentes;
- fatos tipados/versionados com supersessão;
- Policy/Risk Engine determinístico;
- registro de policy vigente por fonte e intervalo de validade;
- Action Gateway allowlisted, confirmation-gated e idempotente;
- receipts verificáveis por hash;
- receipts vinculados a claims e ao ledger do gateway, com relação tool↔receipt fechada;
- store isolado com revisão, dedupe vinculada ao payload e auditoria hashada;
- projeção comum de benchmark;
- adapter completo do workflow atual para comparação;
- scorer reprodutível, matriz P0–P3 e gate congelado.

## Substituídos ou refatorados

Nenhum componente de produção foi substituído. As refatorações ficaram nos novos módulos de LAB e benchmark:

- deduplicação de `reused_fact_keys` no adapter de teste;
- precedência P0 e handoff fail-closed;
- validação fechada de input e output do provider;
- fatos versionados persistidos entre turnos;
- idempotência vinculada ao payload e isolamento por conversa;
- receipts vinculados a tool, claim, payload, referência e ledger;
- replays realmente independentes e evidence manifests por passe;
- scanner de privacidade endurecido e IDs de execução alfabéticos, sem falso positivo aleatório de CPF;
- status do scorer distinguindo execução válida com e sem falhas.

O serializador canônico com rejeição de números não finitos vive somente em `motor-v2/`. O helper compartilhado do
runtime v1 permaneceu byte-idêntico à base.

O runtime atual e os contratos de produção ficaram inalterados.

## Commits isolados

- `28ce676dfc89d4cfbb6f9ff718eadf4500b7e00c` — Motor V2 de LAB;
- `e0b535e3c1a75da01a4d449e9cff33242de44217` — adapters e framework de benchmark;
- `47a3d79fa98704e1a3080d767c68a0264fb08204` — primeira documentação;
- `35e8cd723c3dbe861a8ba2ba0f9adaa6d435ae09` — hardening dos gates;
- `8f8536d1a003fbebeea2eabece48046fd0a536c7` — binding de receipts ao ledger e claims;
- `40a9327000bc4da821110c5033ecc5b28c10b866` — boundaries de provider, input, dedupe e actions;
- `679598404eb5aa24b9bba5af6fba6f72437fca1f` — status e IDs privados reprodutíveis;
- `25854b8aae3a252d02d1e36679c8ab71732a9025` — documentação intermediária;
- `4bf77bbbc9b6672d43fb3fc2b79786fa246ce553` — hardening de P0, receipts, idempotência e scorer;
- `f47dbdc7f3f989c3603807a7cb74b981e7f1e30a` — snapshot do request antes de awaits;
- `41be05d3748c44eb8efe7edc87c108ca9f889d3d` — bloqueio de resultado indeterminado;
- `d0ac72a0851a737f812d49f83503f0ebbe643b6f` — rejeição de payload não JSON;
- `4b81de5e7ea87a5981bad8a495171762ca90cb36` — serialização canônica isolada no Motor V2.

Base preservada: `060c795308e18db265d04416de6ae6d25f692f24`.
