# Fonte autoritativa do Santana Authority Gateway

Caminho neutro, de propósito. Este diretório **não pertence** a nenhuma
implementação: nem à referência Python em `referencia/`, nem ao Gateway TS/Deno
quando ele existir. As duas leem daqui.

## O que vive aqui

| | |
| --- | --- |
| `catalogo/exumacao.v1.json` | Catálogo oficial estruturado do assunto EXUMAÇÃO |
| SHA256 | `22e1e1f0f03e5c1d77ee437fa5dfcd5f23502cc31a3bb575cb6a8dc56cd03f51` |
| `release_id` derivado | `exu-1.0-32cc48f26797` |

**Uma única cópia operacional.** Há teste que falha se aparecer uma segunda
(`referencia/tests/test_invariantes_dominio.py`).

## O que não vive aqui

Os catálogos de domínio (`topics`, `goals`, `facts`, `relations`, `questions`)
continuam em `santana-conversation-domain/`, onde sempre estiveram. O
`release_id` é derivado do conteúdo deste catálogo **mais** os cinco de lá — um
byte diferente em qualquer um deles muda o identificador.

As fixtures dos vetores de conformidade ficam isoladas em
`referencia/vetores/fixtures/` e **nunca** neste caminho. Não se fabrica
conflito, fonte reprovada ou fato inexistente na base oficial para fazer teste
passar.

## Proveniência

Cópia byte-idêntica de `experiments/parlant-poc/catalogo/exumacao.v1.json` na
baseline `714f0fed21d56f9cb7317ba8c9c810029f58376a`. A prova de que a mudança de
lugar não mudou o conhecimento é o `release_id`: ele é derivado do conteúdo, e
continua sendo o mesmo que a C1 real da Fase 1B registrou.

## Mapeamentos pendentes

O arquivo carrega `mapeamentos_pendentes` com duas decisões humanas em aberto —
`MAP_MODALIDADE_TARIFARIA` e `MAP_VIGENCIA_TABELA_TARIFARIA`. Enquanto a
primeira não for decidida, a consulta genérica de preço responde
`NEEDS_CONTEXT` e o atendimento pergunta; nenhuma tarifa é escolhida por
modelo, por inferência ou por semelhança de nome.
