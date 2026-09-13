# Testes, correções e regressões

## Suites finais

- Deno format: PASS;
- Deno lint: PASS;
- Deno type-check: PASS;
- domínio + benchmark: **317/317 testes Deno PASS**;
- Authority Gateway: **25/25 testes Deno PASS**;
- Python/scorer: **9/9 PASS**;
- fixture/schema/manifest validation: PASS;
- três replays do V2: traces e scores idênticos;
- idempotência: 20/20 casos em cada execução;
- rede: 0 chamadas;
- efeitos externos: 0;
- adapters de produção carregados: não.

O teste amplo do repositório foi executado no HEAD e no commit-base. Ambos param no mesmo erro de tipo preexistente em
`edge-functions/_shared/tests/official-runtime-store_test.ts:121`; ele não está no diff destas fases.

## Ciclos autônomos de diagnóstico e correção

### Passe 1 — inválido para decisão

O Motor V2 passou todas as assertions, porém o gate foi bloqueado por dois hard guards nos casos 11 e 25 do workflow
atual. O adapter emitia chaves duplicadas em `reused_fact_keys`, contrariando o schema de trace.

Diagnóstico: erro de instrumentação do adapter, não falha de compreensão, policy ou Motor V2.

Correção mínima:

- deduplicação por `Set` antes de ordenar/emitar `reused_fact_keys`;
- novo teste cobrindo múltiplos goals com a mesma chave;
- rerun direcionado e regressão completa.

### Passes 2–4 — auditoria e hardening

Auditorias independentes encontraram riscos que o resultado agregado inicial não expunha:

- exceções de fluxo podiam suprimir P0;
- input/output do provider e evidência de turnos não estavam totalmente fechados;
- fatos de turnos posteriores e isolamento entre conversas precisavam de garantias explícitas;
- dedupe por inbound não estava vinculado ao payload;
- receipts eram verificáveis por hash, mas não pelo ledger/claim/tool exatos;
- os três replays precisavam provar arquivos, IDs e caminhos independentes;
- o scanner de privacidade precisava de canários negativos e paths enganosos.

Foram aplicadas correções mínimas em cada camada e adicionados testes adversariais. Cada passe anterior foi mantido como
evidência superseded e não participa do veredito final.

### Passe 5 — descartado como evidência final

O gate passou, porém uma execução independente demonstrou nondeterminismo no identificador aleatório: um UUID podia
conter 11 dígitos consecutivos e ser corretamente sinalizado pelo scanner como possível CPF. O passe 5 foi descartado.

Correção: o runner preserva os 128 bits do UUID por um mapeamento bijetivo dos 16 nibbles para `a`–`p`. O ID deixa de
conter dígitos sem reduzir entropia. Um teste regressivo valida formato, distinção e rejeição de fonte inválida.

Também foi corrigido o status do scorer: V2 sem falhas agora é `VALID_NO_SYSTEM_FAILURES`, não
`VALID_WITH_SYSTEM_FAILURES`.

### Passe 6 — final

- hard guards: 0;
- P0/P1 no V2: 0/0;
- gate: PASS;
- nenhuma regressão por caso ou dimensão.
- 281/281 assertions em cada um dos três replays V2;
- 170/281 assertions no workflow atual; 111 falhas classificadas.

## Regressões encontradas e resolvidas

- duplicação de chave no trace do adapter atual: resolvida;
- supressão indevida de P0: resolvida;
- input aninhado/labels/evidência fora do contrato: resolvidos;
- dedupe sem vínculo ao payload e possível bleed de conversa: resolvidos;
- receipts sem binding de claim/ledger/tool: resolvidos;
- replays e evidência sem independência/proveniência suficiente: resolvidos;
- falso positivo aleatório de CPF em UUID do runner: resolvido;
- status enganoso do relatório sem falhas: resolvido;
- nenhuma regressão funcional no runtime v1;
- nenhuma regressão observada no Motor V2 nas 20 fixtures.
