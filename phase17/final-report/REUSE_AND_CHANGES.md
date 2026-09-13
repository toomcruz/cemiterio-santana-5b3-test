# Componentes reaproveitados e mudanças

## Reaproveitados do sistema atual

- normalização e hashing canônico do runtime;
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
- store isolado com revisão, dedupe e auditoria hashada;
- projeção comum de benchmark;
- adapter completo do workflow atual para comparação;
- scorer reprodutível, matriz P0–P3 e gate congelado.

## Substituídos ou refatorados

Nenhum componente de produção foi substituído. A única correção após o primeiro benchmark foi no adapter de teste:
`reused_fact_keys` passou a ser deduplicado antes da emissão do trace. O runtime atual e os contratos de produção
ficaram inalterados.

## Commits isolados

- `28ce676dfc89d4cfbb6f9ff718eadf4500b7e00c` — Motor V2 de LAB;
- `e0b535e3c1a75da01a4d449e9cff33242de44217` — adapters e framework de benchmark.

Base preservada: `060c795308e18db265d04416de6ae6d25f692f24`.
