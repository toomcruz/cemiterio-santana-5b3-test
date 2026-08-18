# Evidência histórica

Artefatos de laboratório preservados como registro. **Nada aqui é runtime de
produção**, nada aqui é fonte de autoridade, e nada aqui deve ser importado por
código que atenda munícipe.

Cada arquivo é cópia literal de um artefato gerado durante a POC. Nenhum foi
editado ao ser trazido para cá — o valor deles está em serem o que foram na
hora em que foram produzidos.

## Baseline congelada

| | |
| --- | --- |
| Tag | `poc/exumacao-fase4a` |
| Commit | `714f0fed21d56f9cb7317ba8c9c810029f58376a` |
| Data | 2026-08-18 |
| Assunto | `Fase 4A: corrigir o caminho real antes de repetir a C1` |

A tag aponta para o commit funcional da Fase 4A. Ela **não** aponta para
`c17ac1e534865ddb4549cf124d3a68a78b3e1c4d`, que vem depois e acrescenta apenas
um CLI de cache inerte, sem definir baseline funcional.

## Commits e branches experimentais referenciados

| Ref | Commit | Papel |
| --- | --- | --- |
| `poc/exumacao-fase4a` | `714f0fe` | **Baseline funcional** — origem de todos os arquivos deste diretório |
| `claude/parlant-poc-gemini-bjab09` | `c17ac1e` | Ponta da POC; acrescenta o CLI de cache de release |
| `lab/parlant-poc` | `8a14d1f` | Ancestral; sem tabela tarifária e sem release cache |
| Run de CI diagnosticado | `32146735829` | A primeira C1 real, que não chegou ao ToolCaller |

A POC completa continua recuperável em `git show poc/exumacao-fase4a` e nas
branches acima. Nada foi apagado.

## O que está aqui

### Baterias e determinismo

- **`synthetic-validation-report.json`** — bateria de 300 conversas / 1.059
  turnos, seed `20260817`, com o Parlant real e provedor de linguagem
  determinístico. Casamento de guidelines 573/573, zero falsos positivos, zero
  turnos com erro, `cross_session_contamination: 0`.
- **`synthetic-determinism.json`** — duas execuções com a mesma seed,
  divergências vazias.
- **`SYNTHETIC_VALIDATION_REPORT.md`** — leitura humana da bateria, incluindo o
  que ela **não** prova.

### Gates de autoridade

Os dez gates aparecem zerados no bloco `violacoes` de
`synthetic-validation-report.json`, junto de `modos_de_falha` (12 modos
testados, 0 violações) e `isolamento`.

> **Limitação central:** todos os gates estão provados **apenas contra o
> provedor sintético**. O caminho real com Gemini nunca completou um turno. A
> bateria prova que a arquitetura se sustenta, não que o modelo adere a ela.

### Diagnóstico do ToolCaller

- **`tool-schema-inspection.json`** — captura do schema entregue ao modelo.
  Prova que as tools de consulta chegam com `parameters={}` e `required=[]`, e
  que o domínio fechado dos argumentos de registro chega intacto. Foi o
  instrumento que localizou a causa do argumento `<<__missing__>>`.
- **`DIAGNOSTICO-C1-32146735829.md`** — por que a primeira C1 real falhou:
  nenhum lote de tool calling foi solicitado; 1.176 s de 1.180 s foram gastos
  esperando o rate limiter, com a inicialização levando 991,8 s.

### Decisões arquiteturais

- **`GATE-FASE-4.md`** — o documento mais importante deste diretório. Registra
  as quatro correções da Fase 4A e, principalmente, **o limite honesto de cada
  medição**: por que o micro-benchmark do cache não mede o que interessa, e por
  que a resposta que menciona valor precisa nascer da tool em vez de ser uma
  resposta armazenada.
- **`bench-release.json`** — cold × warm do cache de release com provedor
  sintético: 27 operações de embedding evitadas, e nenhuma medição do lado da
  geração.

### Gemini: modelos, cota e limitações conhecidas

- **`POC-README.md`** — cópia do README da POC na baseline. Contém a tabela de
  modelos testados contra a cota da chave (`2.5-pro` e `2.5-flash-lite` com
  404 para chaves novas; `2.5-flash` a 5 req/min inviabilizando o start;
  `3.7-flash` com 429 persistente) e a seção de limitações conhecidas.

## O que deliberadamente não está aqui

| Não copiado | Motivo |
| --- | --- |
| `catalogo/exumacao.v1.json` | É catálogo autoritativo, não evidência. Copiá-lo criaria uma segunda fonte de verdade. Permanece congelado sob a tag e é lido de lá. |
| Código executável (`santana_parlant_poc/`, `scripts/`, `tests/`) | Nenhum teste deste repositório depende dele. Fica preservado sob a tag; movê-lo para cá o transformaria em código de manutenção sem executá-lo. |
| Instrumentação do sandbox local (`nono/`) | Ambiente de execução específico da POC. A prova de zero rede externa que importa é o `NetworkGuard`, e ela já está contabilizada no relatório da bateria. |
| Secrets, chaves, tokens | Nunca existiram em arquivo — a chave da POC vinha de secret de CI e o laboratório só reportava presença. Varredura executada antes da cópia: nenhuma ocorrência. |
| `PARLANT_HOME`, caches, índices | Estado temporário de execução, sem valor de registro. |
| Dados pessoais | A bateria é sintética. O `123.456.789-00` que aparece em `tool-schema-inspection.json` é o exemplo-placeholder declarado no próprio schema das tools, não um CPF real. |

## Como usar

Para entender **por que** uma decisão foi tomada, leia `GATE-FASE-4.md`.
Para conferir **o que foi medido**, leia os `.json`.
Para saber **o que continua sem prova**, leia a seção de limitações do
`POC-README.md` e o aviso sobre o provedor sintético acima.

Para reproduzir qualquer coisa, recupere a POC pela tag — não por estes
arquivos:

```
git show poc/exumacao-fase4a --stat
git checkout poc/exumacao-fase4a -- experiments/parlant-poc
```
