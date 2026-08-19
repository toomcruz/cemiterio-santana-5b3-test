# Implementação de referência do Santana Authority Gateway

**Isto não é runtime de produção.** É o gabarito contra o qual o Gateway TS/Deno
será medido pelos vetores de conformidade V1–V12. Enquanto o porte não existir,
esta é a única implementação do Gateway que roda.

## Por que este código saiu da baseline congelada

Até a Fase 1B, o Gateway vivia apenas sob a baseline `714f0fe`, e
`docs/evidencia/README.md` registrava que código executável **não** havia sido
copiado, porque nenhum teste deste repositório dependia dele.

A Fase 2 mudou o fato que sustentava aquela decisão. Ela exige:

- corrigir a referência (desempate, códigos de erro, leitor de argumentos,
  `opcoes_por_campo`);
- rodar os vetores contra ela em CI, a cada PR.

Nenhuma das duas coisas é possível contra um commit congelado — congelado é
justamente o que ele deve continuar sendo. Então o código passou a viver aqui,
como código mantido e testado, e a baseline continua sendo o registro histórico
do que a POC era.

## Proveniência

| | |
| --- | --- |
| Origem | `714f0fed21d56f9cb7317ba8c9c810029f58376a`, `experiments/parlant-poc/` |
| Pacote de origem | `santana_parlant_poc` → `santana_referencia` |
| `domain/` → `dominio/` | mesmos arquivos; `knowledge.py` não veio (nada o importa) |
| Catálogo oficial | **não vive aqui** — `santana-authority/catalogo/exumacao.v1.json`, caminho neutro |
| Catálogos de domínio | **não** copiados — são lidos de `santana-conversation-domain/`, onde já viviam |

A referência não é dona da fonte autoritativa. Ela é implementação de
referência para conformidade, e nada mais: o catálogo oficial fica num caminho
neutro que o Gateway TS/Deno lerá igual.

Prova de que a mudança de lugar não mudou o conhecimento: o `release_id`
calculado aqui é `exu-1.0-32cc48f26797`, exatamente o mesmo da C1 real da
Fase 1B. Ele é derivado do conteúdo do catálogo oficial mais os cinco catálogos
de domínio; se qualquer byte tivesse mudado, o identificador mudaria.

## O que foi alterado em relação à baseline

| Alteração | Motivo |
| --- | --- |
| Desempate entre finalistas por `entry_id` de menor code point | `finalistas[0]` era a ordem do arquivo: duas implementações corretas devolveriam `entry_id` diferente |
| `ErroDeCatalogo` com código estruturado na carga | mensagem de exceção em português não atravessa a fronteira Python/TypeScript |
| `opcoes_por_campo` no lugar de `opcoes_possiveis` | a lista plana não dizia a qual campo cada opção pertencia |
| `argumentos.py` — contrato canônico e leitor de eventos | o `or` falsy da POC transformava `{}` em `null` |
| `consultar_via_tool` — canonização na fronteira | argumento fora do contrato não pode chegar à consulta |
| Cache de catálogo por caminho | as fixtures dos vetores carregam catálogos diferentes no mesmo processo |
| `limpar_caches()` e `definir_escopo_de_fixture()` no catálogo de domínio | os vetores trocam o diretório de domínio entre casos; ambos são vazios/no-op em runtime, e há teste exigindo isso |

O catálogo oficial **não** foi alterado, e o catálogo de domínio tampouco. As
fixtures ficam em `vetores/fixtures/` e nunca no caminho autoritativo — inclusive
a fixture de domínio, que declara **apenas o que acrescenta** e é montada em
diretório temporário sobre os arquivos autoritativos lidos sem edição.

## Como rodar

```
python3 referencia/runner/executar_vetores.py
python3 -m unittest discover -s referencia/tests -t referencia/tests
```

Só stdlib. Sem rede, sem modelo, sem chave. É o que a CI executa.
