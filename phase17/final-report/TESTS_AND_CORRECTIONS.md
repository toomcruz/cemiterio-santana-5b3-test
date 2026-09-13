# Testes, correções e regressões

## Suites finais

- Deno format: PASS;
- Deno lint: PASS;
- Deno type-check: PASS;
- TypeScript: **306/306 PASS**;
- Python/scorer: **4/4 PASS**;
- fixture/schema/manifest validation: PASS;
- três replays do V2: traces e scores idênticos;
- idempotência: 20/20 casos em cada execução;
- rede: 0 chamadas;
- efeitos externos: 0;
- adapters de produção carregados: não.

## Correção autônoma

### Passe 1 — inválido para decisão

O Motor V2 passou todas as assertions, porém o gate foi bloqueado por dois hard guards nos casos 11 e 25 do workflow
atual. O adapter emitia chaves duplicadas em `reused_fact_keys`, contrariando o schema de trace.

Diagnóstico: erro de instrumentação do adapter, não falha de compreensão, policy ou Motor V2.

Correção mínima:

- deduplicação por `Set` antes de ordenar/emitar `reused_fact_keys`;
- novo teste cobrindo múltiplos goals com a mesma chave;
- rerun direcionado e regressão completa.

### Passe 2 — final

- hard guards: 0;
- P0/P1 no V2: 0/0;
- gate: PASS;
- nenhuma regressão por caso ou dimensão.

O passe 1 foi preservado apenas como evidência auditável e não participa do veredito final.

## Regressões encontradas e resolvidas

- duplicação de chave no trace do adapter atual: resolvida;
- nenhuma regressão funcional no runtime v1;
- nenhuma regressão observada no Motor V2 nas 20 fixtures.
