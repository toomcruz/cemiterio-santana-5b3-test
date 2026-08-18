# Catalogo oficial estruturado — Exumacao

Este diretorio e a **unica** fonte de conhecimento que o Parlant consulta em
runtime, sempre atraves do Santana Authority Gateway. O Parlant nao le PDF, nao
le tabela solta, nao le Supabase e nao le arquivo arbitrario.

## Por que estruturado, e nao um texto

Preco de exumacao nao e um numero. Ele depende do servico, do tipo de sepultura
e do destino dos restos. Um catalogo com `preco_exumacao = X` responderia o
valor errado com toda a confianca do mundo — e o atendimento nao teria como
perceber. Por isso cada entrada declara **a que caso se aplica**, e o Gateway so
responde quando o caso em atendimento determina essa aplicabilidade.

## Estado atual: honesto, nao pronto

| Tipo de informacao | Fonte oficial aprovada | Resposta hoje |
|---|---|---|
| ASSINATURA_EXUMACAO | sim (`relations.v1.json`, decisao humana 6) | AVAILABLE |
| JAZIGO_DESTINO | sim (`facts.v1.json`, decisoes 1 e 2) | AVAILABLE |
| OSSUARIO | sim (`topics.v1.json`) | AVAILABLE |
| RESTOS_JA_EXUMADOS | sim (`relations.v1.json`, decisao 5) | AVAILABLE |
| **PRECO** | **sim** (`Tabela_Politica_Tarifaria_07_01_2026`) | AVAILABLE com modalidade; **NEEDS_CONTEXT** sem ela |
| **DOCUMENTOS** | **nao** | NOT_AVAILABLE / encaminha |
| **PRAZO** | **nao** | NOT_AVAILABLE / encaminha |
| **PROCEDIMENTO_ADMINISTRATIVO** | **nao** | NOT_AVAILABLE / encaminha |
| **REGULARIDADE_DO_JAZIGO** | **nao** | NOT_AVAILABLE / encaminha |
| **SEMI_INTACTO** | **nao** | NOT_AVAILABLE / encaminha |
| **TRANSPORTE** | **nao** | NOT_AVAILABLE / encaminha |

Os seis de baixo **nao estao publicados porque nao existe fonte oficial
aprovada carregada aqui** — nao porque a POC decidiu esconder. A estrutura para
receber cada um ja esta declarada em `tipos_de_informacao`; falta o dado
aprovado. Enquanto faltar, o atendimento diz que a Administracao informa, e
isso e uma resposta correta, nao um placeholder.

**Isto e o que impede a Fase 3 de ser dada como concluida.** Para fechar,
alguem com autoridade precisa entregar os valores oficiais e aprovar as fontes.

## Preco: tres tarifas, nenhuma escolhida por ninguem

A `Tabela_Politica_Tarifaria_07_01_2026` traz tres tarifas de exumacao:

| `modalidade_tarifaria` | Nome na tabela | Valor |
|---|---|---|
| `EXUMACAO_DE_OSSUARIO` | Exumação de ossuário | R$ 106,57 |
| `SEPULTURA_CESSAO_TERRENO_PRAZO_INDETERMINADO` | Exumação de sepultura em cessão de terreno a prazo indeterminado | R$ 586,04 |
| `SEPULTURA_CESSAO_GAVETA_UNITARIA_PRAZO_FIXO` | Exumação de sepultura em cessão de gaveta unitária a prazo fixo | R$ 351,67 |

Isso muda o tipo de risco. Antes o perigo era o modelo inventar um valor onde
nao havia nenhum. Agora o perigo e ele **escolher** entre valores reais: um
preco certo aplicado ao caso errado e tao ruim quanto um preco inventado, e bem
mais convincente.

Por isso `modalidade_tarifaria` e criterio de aplicabilidade, e o Gateway
responde `NEEDS_CONTEXT` — nao `NOT_AVAILABLE` — quando o caso nao diz qual e a
modalidade. `NEEDS_CONTEXT` nao encaminha para a Administracao: manda perguntar,
e a resposta diz exatamente o que falta (`contexto_faltante`) e quais sao as
opcoes (`opcoes_possiveis`).

### Duas lacunas registradas, nao presumidas

Em `mapeamentos_pendentes`:

1. **`MAP_MODALIDADE_TARIFARIA`** — nao existe equivalencia declarada entre os
   nomes da tabela e os conceitos internos Santana (`jazigo de familia`,
   `quadra geral`, `gaveta`). Atencao ao homonimo: "Exumação de ossuário" e a
   exumacao **feita num** ossuario, enquanto `transport_destination=OSSUARIO` e
   o destino **para onde** os restos vao. Ligar os dois seria inventar regra.
   Enquanto a decisao humana nao vier, o contexto derivado do caso nunca
   determina a modalidade — e a pergunta generica sempre pergunta de volta.

2. **`MAP_VIGENCIA_TABELA_TARIFARIA`** — `07_01_2026` foi lido como
   `2026-01-07` (dd_mm_aaaa). A leitura mm_dd_aaaa daria `2026-07-01`. Nenhuma
   das duas esta declarada dentro da fonte. Precisa de confirmacao.

## Como carregar uma fonte oficial

1. **Registre a fonte** em `fontes`, com `aprovada: true` apenas depois da
   aprovacao humana. Fonte com `aprovada: false` e ignorada em runtime — de
   proposito: rascunho nao atende municipe.

   ```json
   {
     "source_id": "SRC_TABELA_PRECOS_2026",
     "tipo": "DOCUMENTO_OFICIAL",
     "referencia": "Tabela de precos 2026, Administracao do Cemiterio Santana",
     "aprovada": true,
     "nota": "aprovada em <data> por <quem>"
   }
   ```

2. **Adicione as entradas**, uma por combinacao de aplicabilidade. Os campos de
   aplicabilidade validos de cada tipo estao em `tipos_de_informacao`.

   ```json
   {
     "entry_id": "EXU_PRECO_JAZIGO_OUTRO_CEMITERIO",
     "tipo_informacao": "PRECO",
     "aplicabilidade": {
       "servico": "EXUMACAO",
       "tipo_de_sepultura": "JAZIGO",
       "tipo_de_destino": "OUTRO_CEMITERIO"
     },
     "valor": { "valor": "R$ 000,00" },
     "vigencia": { "inicio": "2026-01-01", "fim": null },
     "source_id": "SRC_TABELA_PRECOS_2026"
   }
   ```

3. **Rode a suite**: `.venv/bin/python -m pytest tests/test_gateway.py -q`.

Nenhum passo envolve o Gemini. Nenhum PDF e passado ao modelo em runtime para
ele "descobrir" a regra.

## Regras que o Gateway aplica sozinho

* **Contexto insuficiente vira pergunta, nao escolha.** Havendo mais de uma
  entrada possivel e nenhuma determinada, o status e `NEEDS_CONTEXT` com a lista
  do que falta. O Gateway nao desempata, e o modelo nao tem por onde desempatar.
* **Contexto que contradiz todas as entradas** vira `NOT_AVAILABLE` com motivo
  `CONTEXTO_INCOMPATIVEL_COM_AS_ENTRADAS`.
* **Entrada mais especifica vence.** `{situacao_do_conjuge: VIVO}` ganha da
  entrada geral `{}`.
* **Criterio ausente do contexto nao casa.** O silencio nunca e tratado como
  confirmacao — se o caso nao diz o tipo de sepultura, o preco do JAZIGO nao e
  respondido; o motivo vira `APLICABILIDADE_INDETERMINADA`.
* **Duas fontes aprovadas discordando no mesmo caso viram `CONFLICT`**, nao
  escolha. Conflito encaminha para a Administracao.
* **Vigencia e respeitada.** Entrada fora do periodo nao responde.
* **Contexto vem de fato confirmado.** Alegacao pendente de verificacao pela
  Administracao nao seleciona resposta oficial.
* **Schema desconhecido falha fechado.** Um catalogo com `schema_version`
  diferente de `1.0` faz o runtime recusar carregar, em vez de adivinhar.

## release_id

O `release_id` e derivado do conteudo deste catalogo mais os catalogos de
dominio (`santana-conversation-domain/*.v1.json`). Mudou o conhecimento, mudou o
id — e todo log e toda resposta ficam correlacionaveis a uma versao exata.
