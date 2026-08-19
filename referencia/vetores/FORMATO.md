# Formato neutro dos vetores de conformidade

Os vetores vivem **fora** das implementações. A referência Python e o futuro
Gateway TS/Deno leem os mesmos arquivos e comparam do mesmo jeito. Divergência
em qualquer vetor bloqueia o porte — e **não se resolve ajustando o vetor**.

## Campos

| Campo | Papel |
| --- | --- |
| `vector_id` | identidade estável do caso |
| `vetor` | `V1`…`V12` |
| `titulo` | o que este caso, especificamente, prova |
| `catalogo_ref` | `oficial` ou nome de arquivo em `fixtures/` |
| `release_id_esperado` | divergência ⇒ vetor **INVÁLIDO**, não reprovado |
| `operacao` | `carregar` · `consultar` · `consultar_com_canned` · `consultar_via_tool` · `canonizar_argumentos` · `registrar_fato` |
| `referencia` | data civil explícita — nunca "hoje" |
| `estado_do_caso_inicial` | só em `registrar_fato` |
| `entrada` | argumentos da operação |
| `saida_esperada` | documento canônico completo |
| `escritas_esperadas` | escritas no caso após a operação |

## Resultados

| | |
| --- | --- |
| **PASS** | saída real == esperada, documento inteiro, **e** escritas iguais |
| **FAIL** | qualquer diferença: chave a mais, chave a menos, ordem diferente, status certo com motivo errado, `entry_id` diferente |
| **INVÁLIDO** | `release_id` divergente. O vetor não roda e **não conta como PASS** |

`INVÁLIDO` existe para separar "a implementação está errada" de "você rodou o
vetor contra outro conhecimento". A segunda situação não é uma reprovação — é um
vetor que precisa ser regerado.

## Regras de canonização

1. **Comparação total.** O documento inteiro. Chave extra é FAIL — é o que
   impede uma implementação de acrescentar um campo que vaze informação.
2. **Ausência por omissão.** A chave não aparece. `null` não existe na forma
   canônica; vazio é `{}` ou `[]`.
3. **Ordenação por code point Unicode**, explicitamente. `sorted()` do Python é
   por code point; o `sort()` padrão de JavaScript é por code unit UTF-16 e
   `localeCompare` difere em acentuação. Sem esta regra, `opcoes_por_campo`
   diverge nas duas implementações.
4. **Datas civis, nunca timestamps.** Fuso `America/Sao_Paulo`, comparação como
   data ISO. O `Date` do Deno é baseado em UTC — risco nomeado.
5. **Vigência inclusiva nas duas pontas.**
6. **Dinheiro é string.** `"R$ 106,57"` nunca vira número. Nenhum ponto
   flutuante no contrato.
7. **Códigos, não frases.** Status e motivos são códigos. As mensagens de
   `registrar_fato` são pinadas nos vetores de propósito: elas chegam ao modelo
   como resultado de tool, e uma mudança silenciosa nelas muda o que o munícipe
   ouve.

## Limite declarado

`escritas_esperadas` só é observável em `registrar_fato` — é o único caminho que
recebe um caso. Nas operações de consulta a lista é sempre vazia porque não há
caso a observar, não porque uma escrita foi impedida. Onde o V9 precisa provar
ausência de escrita, ele usa `registrar_fato`.

## Fixtures

`fixtures/` existe porque quatro situações **não são alcançáveis** com o
catálogo oficial: não há conflito entre fontes, não há fonte reprovada, todo
tipo sem entradas exige fonte oficial, e nenhuma entrada tem `fim` de vigência.

Regra: fixture nunca entra no caminho do catálogo autoritativo, tem `release_id`
próprio, e traz `nota` dizendo que é fixture. **Não se fabrica conflito na base
oficial para testar o V3.**
