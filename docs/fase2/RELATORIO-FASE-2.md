# Relatório da Fase 2

```
STATUS: CONTRATOS R1-R6 FIXADOS · V1-V12 CONGELADOS · 46/46 PASS NA REFERENCIA
NAO INICIA A FASE 3. NENHUM PORTE TS/DENO FOI FEITO.
```

Base: `origin/main` `fcb3871`. Nenhuma chamada NVIDIA, nenhuma chamada Gemini,
nenhuma rede. Tudo que roda aqui usa apenas a stdlib do Python.

## 1. O que foi entregue

| Entrega | Onde |
| --- | --- |
| Contratos finais R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Especificação final V1–V12 | `docs/fase2/VETORES-V1-V12.md` |
| Formato neutro dos vetores | `referencia/vetores/FORMATO.md` |
| Implementação de referência corrigida | `referencia/santana_referencia/` |
| Vetores (46 casos) e fixtures | `referencia/vetores/` |
| Executor | `referencia/runner/executar_vetores.py` |
| Testes | `referencia/tests/test_vetores.py` |
| Resultado dos vetores | `docs/fase2/resultado-vetores.json` |
| Adendo à evidência da C1 | `docs/evidencia/c1-nvidia/CORRECAO-C1.md` |

## 2. Resultado dos vetores

```
CASOS: 46   PASS: 46   FAIL: 0   INVALIDO: 0
V1 V2 V3 V4 V5 V6 V7 V8 V9 V10 V11 V12  ->  todos PASS
```

Testes: 12, todos OK. Quatro deles provam que o executor **consegue reprovar**
(saída diferente, chave extra, escrita inesperada, `release_id` divergente como
`INVÁLIDO` e nunca `PASS`). Três são mutações que reintroduzem os defeitos
corrigidos e exigem reprovação do vetor correspondente:

| Mutação reintroduzida | Vetor que reprova |
| --- | --- |
| `or` falsy no leitor de argumentos | `V12-A` |
| `finalistas[0]` no desempate | `V01-C` |
| Fronteira sem canonização de argumentos | `V12-L` |

Sem estes, "46 PASS" não seria prova de nada.

## 3. As seis correções exigidas antes do porte

| # | Exigência | Estado | Prova |
| --- | --- | --- | --- |
| 1 | Desempate determinístico | feito — `min` por `entry_id` | V01-C, V01-D + mutação |
| 2 | Códigos de erro estruturados | feito — `ErroDeCatalogo` | V07-C |
| 3 | Leitor de argumentos `or` falsy | feito — `ler_argumentos_do_evento` | V12-A + mutação |
| 4 | `opcoes_por_campo` | feito | V02-B |
| 5 | V12 implementado e congelado | feito — 12 casos | V12-A…V12-L |
| 6 | Vetores só contra a referência | feito | nenhuma outra implementação existe |

## 4. Decisões que precisam de ciência do mantenedor

### 4.1 O Gateway saiu da baseline congelada

`docs/evidencia/README.md` registrava que código executável **não** fora copiado
porque nenhum teste do repositório dependia dele. A Fase 2 encerrou essa
condição: corrigir a referência e rodar os vetores em CI não se faz contra um
commit congelado.

O código e o catálogo oficial passaram a viver em `referencia/`. **O catálogo é
cópia byte-idêntica** (SHA256 `22e1e1f0f03e5c1d77ee437fa5dfcd5f23502cc31a3bb575cb6a8dc56cd03f51`),
e a prova de que a mudança de lugar não mudou o conhecimento é o `release_id`
calculado a partir do conteúdo: `exu-1.0-32cc48f26797` — **o mesmo da C1 real da
Fase 1B**. Não há duas fontes de verdade; a cópia sob a baseline vira registro
histórico, como o resto da POC.

Se preferir o caminho inverso — manter o catálogo apenas sob a baseline e
materializá-lo em CI — é reversível, ao custo de acoplar os testes a uma branch
que nunca pode ser apagada.

### 4.2 `opcoes_possiveis` foi removida, não mantida em paralelo

A DECISÃO 1 proíbe a lista plana quando há mais de um campo faltante. Um campo
cuja presença dependesse da cardinalidade quebraria a comparação total dos
vetores, então `opcoes_por_campo` é usada **sempre** e `opcoes_possiveis`
deixou de existir na forma canônica.

### 4.3 V11 tem 6 casos, não 7

A sétima situação — fato com `ai_extractable: false` **sem** ser derivado nem
autoritativo — não existe no catálogo de domínio. Cobri-la exigiria alterar
`santana-conversation-domain/facts.v1.json`, que é autoritativo. Registrada como
lacuna declarada, não omitida.

## 5. O que a Fase 2 não fez

- Não portou nada para TS/Deno.
- Não executou NVIDIA nem Gemini.
- Não tocou n8n, W-API, Supabase ou produção.
- Não alterou `MAP_MODALIDADE_TARIFARIA` nem inferiu
  `OSSUARIO -> EXUMACAO_DE_OSSUARIO`. O vetor **V10-C** existe exatamente para
  provar que essa equivalência continua não sendo feita.
- Não alterou o catálogo oficial para fabricar fixture nenhuma.
- Não apagou branch da POC.

R2, R3 e R4 estão **contratados**, não instrumentados: instrumentá-los é
execução, e execução com modelo depende de autorização. O que era offline neles
está feito (contadores, tetos e chave de cache definidos em contrato).

## 6. Pendências

| Pendência | Natureza |
| --- | --- |
| Tag `poc/exumacao-fase4a` → `714f0fe` | externa; HTTP 403 no push; não bloqueante, não contornada |
| `main` tecnicamente desprotegida | ruleset criado, inaplicável no plano atual; política operacional de 8 regras em vigor |
| `MAP_MODALIDADE_TARIFARIA` | decisão humana; a jornada de preço não termina em valor sem ela |
| `MAP_VIGENCIA_TABELA_TARIFARIA` | confirmação humana de `07_01_2026` |
| Instrumentação de R2/R3/R4 | depende de execução autorizada |
| Léxico de apresentação (R5) e `pergunta_pendente` (R6) | vivem na camada de atendimento, ainda não portada |
| Três workflows órfãos inertes | podem ser desativados quando convier |
