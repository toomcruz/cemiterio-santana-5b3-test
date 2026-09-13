# Testes, correções e regressões

## Suites finais

- Deno format: PASS;
- Deno lint: PASS;
- Deno type-check: PASS;
- domínio + benchmark: **322/322 testes Deno PASS**;
- Authority Gateway: **25/25 testes Deno PASS**;
- Python/scorer: **13/13 PASS**;
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

### Passes 6–7 — gates verdes, evidência superseded

Os passes 6 e 7 ficaram verdes, mas auditorias posteriores encontraram superfícies que exigiam fechamento antes da
assinatura final:

- P0 determinístico também quando um provider já emitia outro sinal P0;
- validação fail-closed de JSON não finito e payloads que não fossem objetos JSON simples;
- snapshot de request antes do primeiro `await` para eliminar TOCTOU;
- serialização de chamadas concorrentes pela mesma idempotency key;
- bloqueio e reconciliação de resultado indeterminado do executor;
- validação de tool/receipt/claim e detecção de claims no texto pelo scorer;
- preservação do runtime v1 sem mudança em helper compartilhado.

Cada correção recebeu teste adversarial. O passe 7 foi superseded depois que a rejeição de não-finitos foi movida do
helper compartilhado para um boundary exclusivo do Motor V2.

### Passe 8 — final

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
- mutação de request durante operação assíncrona: resolvida por snapshot anterior ao primeiro `await`;
- colisão concorrente de idempotency key: resolvida por serialização por chave;
- resposta perdida/resultado indeterminado do executor: bloqueado para reconciliação, sem reexecução na instância;
- payload não JSON e números não finitos: rejeitados no boundary exclusivo do Motor V2;
- alteração involuntária de helper compartilhado v1: revertida; diff final do runtime atual é zero;
- nenhuma regressão funcional no runtime v1;
- nenhuma regressão observada no Motor V2 nas 20 fixtures.
