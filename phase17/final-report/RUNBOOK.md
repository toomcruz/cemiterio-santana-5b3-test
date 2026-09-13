# Runbook reproduzível

Pré-requisitos:

- Deno 2.1.4;
- Python 3.13+;
- checkout no commit isolado final;
- caminho local privado contendo o release imutável da Fase 15.

## Testes

```sh
deno fmt --check santana-conversation-domain/motor-v2 phase17
deno lint santana-conversation-domain/motor-v2 phase17
deno check --no-lock phase17/run_engines.ts
deno test --allow-read santana-conversation-domain phase17
python3 -m unittest discover -s phase17/benchmark/tests -p 'test_*.py'
```

## Engines

Execute `phase17/run_engines.ts` sem `--allow-net`, fornecendo somente o JSONL agregado imutável e um diretório privado
de saída:

```sh
deno run --allow-read --allow-write phase17/run_engines.ts \
  --fixtures "$PHASE15_ROOT/fixtures/gold_v2_executable_fixtures.jsonl" \
  --output-dir "$PRIVATE_RUN_DIR" \
  --v2-replays 3
```

## Scorer

Use `phase17/benchmark/benchmark.py` com fixtures, schemas, manifesto e gate do mesmo `$PHASE15_ROOT`, o trace
`current-workflow-compat-v1.jsonl` e os três traces `motor-v2-replay-*.jsonl`.

Nenhum comando deste runbook autoriza rede, produção ou efeito externo.

## Rollback do desenvolvimento

Depois de preservar os artefatos necessários, o operador pode remover o worktree isolado e excluir o branch
`phase16-motor-v2-isolated`. Isso não toca o checkout base nem produção.
