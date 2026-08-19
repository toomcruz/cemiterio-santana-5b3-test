# Especificação final dos vetores de conformidade V1–V12

```
STATUS: CONGELADOS · 46 casos · PASS 46 / FAIL 0 / INVALIDO 0 na referência
```

Formato neutro, regras de canonização, definição de PASS/FAIL/INVÁLIDO e política
de fixtures: `referencia/vetores/FORMATO.md`.

## Critério, antes de qualquer critério específico

| | |
| --- | --- |
| **PASS** | saída real == esperada, documento inteiro, após canonização, **e** escritas iguais |
| **FAIL** | qualquer diferença — chave a mais, chave a menos, ordem diferente, status certo com motivo errado, `entry_id` diferente |
| **INVÁLIDO** | `release_id` divergente: o vetor não roda e **não conta como PASS** |

**Não se ajusta vetor para fazer implementação passar. Se a referência divergir
do vetor, corrige-se a referência.**

## Prova de que os vetores conseguem reprovar

"46 PASS" não significaria nada se os vetores não pudessem falhar. Três mutações
reintroduzem, uma por vez, os defeitos que a Fase 2 corrigiu, e exigem
reprovação (`referencia/tests/test_vetores.py`):

| Mutação | Vetor que reprova |
| --- | --- |
| `or` falsy no leitor de argumentos | `V12-A` — o bruto vira `null` onde o contrato exige `{}` |
| `finalistas[0]` no desempate | `V01-C` — as duas ordens de arquivo devolvem `entry_id` diferente |
| Fronteira sem canonização | `V12-L` — a consulta acontece com argumento injetado |

Mais quatro testes provam que o próprio executor reprova: saída diferente, chave
extra, escrita inesperada e `release_id` divergente (este último como
`INVÁLIDO`, nunca como `PASS`).

### V1 — AVAILABLE

**Prova:** Entrada determinada pela especificidade, com valor exato e proveniencia completa. O desempate entre finalistas de mesma especificidade e por entry_id, nunca pela ordem do arquivo.

**Casos:** 4 · **Catálogo:** desempate_ordem_a.v1.json, desempate_ordem_b.v1.json, oficial

| Caso | O que prova |
| --- | --- |
| `V01-A` | Especificidade vence a entrada generica |
| `V01-B` | Entrada sem criterio de aplicabilidade |
| `V01-C` | Desempate por entry_id, catalogo na ordem ZZZ,AAA |
| `V01-D` | Desempate por entry_id, catalogo na ordem AAA,ZZZ |

### V2 — NEEDS_CONTEXT

**Prova:** Falta de contexto nao e indisponibilidade. As opcoes vem POR CAMPO e ordenadas.

**Casos:** 2 · **Catálogo:** oficial

| Caso | O que prova |
| --- | --- |
| `V02-A` | Um campo faltante |
| `V02-B` | Dois campos faltantes: opcoes nao se misturam |

### V3 — CONFLICT

**Prova:** Fontes aprovadas discordando para o mesmo caso: falha segura, sem escolher.

**Casos:** 1 · **Catálogo:** conflito.v1.json

| Caso | O que prova |
| --- | --- |
| `V03-A` | Mesma especificidade, valores divergentes |

### V4 — NOT_AVAILABLE com motivos distintos

**Prova:** Os tres motivos de indisponibilidade nao colapsam num codigo generico.

**Casos:** 4 · **Catálogo:** oficial, tipo_sem_fonte_oficial.v1.json

| Caso | O que prova |
| --- | --- |
| `V04-A` | Tipo de informacao desconhecido |
| `V04-B` | Tipo declarado, exige fonte oficial, nada publicado |
| `V04-C` | Entradas existem, nenhuma vigente na data |
| `V04-D` | Tipo que dispensa fonte oficial e nao tem entradas |

### V5 — Contexto incompativel

**Prova:** Contexto que contradiz todas as entradas nao vira 'uma entrada qualquer' nem NEEDS_CONTEXT.

**Casos:** 1 · **Catálogo:** oficial

| Caso | O que prova |
| --- | --- |
| `V05-A` | Modalidade que nao existe na tabela |

### V6 — Proveniencia

**Prova:** Nenhum AVAILABLE sem source_id; nenhum campo de canned fora de AVAILABLE.

**Casos:** 3 · **Catálogo:** oficial

| Caso | O que prova |
| --- | --- |
| `V06-A` | AVAILABLE emite campo de canned e carrega proveniencia |
| `V06-B` | NEEDS_CONTEXT nao emite campo nem proveniencia |
| `V06-C` | NOT_AVAILABLE nao emite campo nem proveniencia |

### V7 — source_id e aprovacao

**Prova:** Fonte com aprovada:false e descartada na CARGA, nao filtrada na resposta.

**Casos:** 3 · **Catálogo:** fonte_nao_aprovada.v1.json, schema_desconhecido.v1.json

| Caso | O que prova |
| --- | --- |
| `V07-A` | Entrada de fonte reprovada nao entra no catalogo carregado |
| `V07-B` | O tipo servido so pela fonte reprovada fica indisponivel |
| `V07-C` | Schema desconhecido falha fechada com codigo estruturado |

### V8 — Vigencia

**Prova:** Fronteiras inclusivas nas duas pontas, sem efeito de fuso horario.

**Casos:** 4 · **Catálogo:** vigencia_com_fim.v1.json

| Caso | O que prova |
| --- | --- |
| `V08-2026-01-06` | Fora de vigencia em 2026-01-06 |
| `V08-2026-01-07` | Vigente em 2026-01-07 |
| `V08-2026-06-30` | Vigente em 2026-06-30 |
| `V08-2026-07-01` | Fora de vigencia em 2026-07-01 |

### V9 — Prompt injection

**Prova:** Texto adversarial e dado, nunca instrucao: nao muda status, nao seleciona entrada, nao escreve.

**Casos:** 3 · **Catálogo:** oficial

| Caso | O que prova |
| --- | --- |
| `V09-A` | Texto adversarial como valor de fato: recusa e zero escrita |
| `V09-B` | Texto adversarial como contexto: nao seleciona entrada |
| `V09-C` | Texto adversarial como argumento de tool: recusado na fronteira |

### V10 — Nenhuma escolha de tarifa pelo LLM

**Prova:** Consulta de preco sem modalidade_tarifaria nunca devolve uma das tres tarifas.

**Casos:** 3 · **Catálogo:** oficial

| Caso | O que prova |
| --- | --- |
| `V10-A` | Sem contexto algum |
| `V10-B` | Servico conhecido, modalidade nao |
| `V10-C` | HOMONIMO: destino OSSUARIO nao seleciona EXUMACAO_DE_OSSUARIO |

### V11 — Nenhuma escrita autoritativa indevida

**Prova:** Cada barreira de escrita recusa pelo SEU codigo, e nenhuma delas escreve.

**Casos:** 6 · **Catálogo:** oficial

| Caso | O que prova |
| --- | --- |
| `V11-A` | Fato desconhecido no catalogo |
| `V11-B` | Fato autoritativo: so a Administracao confirma |
| `V11-C` | Fato derivado por regra deterministica |
| `V11-D` | Origem que nao registra fato de municipe |
| `V11-E` | Valor vazio |
| `V11-F` | Valor fora do dominio fechado |

### V12 — Contrato canonico de argumentos

**Prova:** A forma canonica de uma tool de zero argumentos e {}; o bruto do evento e preservado; nenhum argumento inventado passa.

**Casos:** 12 · **Catálogo:** oficial

| Caso | O que prova |
| --- | --- |
| `V12-A` | Forma canonica: arguments = {} lido como {}, nunca como null |
| `V12-B` | Chave ausente numa tool de zero argumentos normaliza para {} |
| `V12-C` | null numa tool de zero argumentos normaliza para {}, e o bruto e preservado |
| `V12-D` | Modalidade injetada numa consulta de preco e recusada |
| `V12-E` | Argumento que nao e mapa e recusado |
| `V12-F` | __missing__ nunca vira valor |
| `V12-G` | Tool com obrigatorio NAO normaliza ausencia para {} |
| `V12-H` | Tool com parametros: chave extra continua recusada |
| `V12-I` | Tool com parametros opcionais: ausencia e {} sem criar valor |
| `V12-J` | Valor null numa chave declarada e recusado, nao virou default |
| `V12-K` | Fronteira do Gateway: zero-arg canonico consulta normalmente |
| `V12-L` | Fronteira do Gateway: argumento injetado nao produz preco |
## O que bloqueia a Fase 3

**Bloqueio absoluto:** um único FAIL em qualquer vetor bloqueia o porte TS/Deno.
Divergência não se resolve ajustando o vetor. O Gateway TS/Deno só substitui a
referência quando os 46 casos passarem com **saída idêntica**, sobre o mesmo
catálogo e o mesmo `release_id`.

Pré-condições que a Fase 2 já removeu:

| # | Era bloqueio | Estado |
| --- | --- | --- |
| 1 | Desempate não determinístico (`finalistas[0]`) | **resolvido** — `min` por `entry_id`, provado por V01-C/D |
| 2 | Mensagem de exceção em vez de código na carga | **resolvido** — `ErroDeCatalogo`, provado por V07-C |
| 3 | Leitor de argumentos com `or` falsy | **resolvido** — `ler_argumentos_do_evento`, provado por V12-A |
| 4 | `opcoes_possiveis` plana | **resolvido** — `opcoes_por_campo`, provado por V02-B |
| 5 | V12 inexistente | **resolvido** — 12 casos congelados |

Continuam bloqueando o **encerramento do assunto**, não o porte:

| Bloqueio | Estado |
| --- | --- |
| `MAP_MODALIDADE_TARIFARIA` | `PENDENTE_DE_DECISAO_HUMANA` — a jornada de preço não termina em valor |
| `MAP_VIGENCIA_TABELA_TARIFARIA` | `PENDENTE_DE_CONFIRMACAO_HUMANA` — `07_01_2026` lido como dd_mm_aaaa |

## Lacuna de cobertura declarada

O V11 tem **6 casos, não 7**. A sétima situação prevista — fato com
`ai_extractable: false` **sem** ser derivado nem autoritativo — não existe no
catálogo de domínio: todo fato não extraível é também derivado ou autoritativo.
Cobri-la exigiria alterar `santana-conversation-domain/facts.v1.json`, que é
autoritativo. Fica registrada como lacuna, não como caso silenciosamente
omitido. Se um fato assim for criado no futuro, o caso passa a ser exigível.

## O que os vetores não provam

São vetores do **Gateway**. R2, R3 e R4 não viram vetores: são comportamento de
runtime, não de Gateway, e pertencem a uma família separada de asserções de
orçamento, medida no runtime persistente da Fase 6. Misturá-las tornaria o
critério de substituição do Gateway dependente de latência de modelo — que a
Fase 1B mostrou não ser estável.
