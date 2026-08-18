# Validacao sintetica — Parlant real + Santana

**PARLANT SYNTHETIC VALIDATION: PASS**

- data: 2026-08-18T11:29:24+00:00
- parlant: 3.3.2
- commit: a6d3fd018144
- seed: 20260817
- provider: sintetico (sem LLM externo, sem secret)

## Inicializacao

- tempo ate o servidor no ar: **1.36s**
- duracao total da bateria: 108.62s
- entidades esperadas: `{'guidelines': 20, 'relationships': 16, 'journey_states': 5, 'tools': 19, 'canned_responses': 9, 'glossary_terms': 8}`
- entidades carregadas: `{'guidelines': 22, 'relationships': 21, 'journeys': 1, 'journey_states': 5, 'tools': 19, 'canned_responses': 9, 'glossary_terms': 8}`
- entidades faltando: `nenhuma`

## Schemas do Parlant

- encontrados nesta POC: **16**
- atendidos semanticamente: CannedResponseDraftSchema, CannedResponseFieldExtractionSchema, CannedResponsePreambleSchema, CannedResponseSelectionSchema, CustomerDependentActionSchema, GenericActionableGuidelineMatchesSchema, GenericObservationalGuidelineMatchesSchema, GenericResponseAnalysisSchema, GuidelineContinuousPropositionSchema, JourneyNextStepSelectionSchema, NonConsequentialToolBatchSchema, ReachableNodesEvaluationSchema
- atendidos estruturalmente: AgentIntentionProposerSchema, JourneyBacktrackCheckSchema, ReachableNodesEvaluationSchema, RelativeActionSchema, ToolRunningActionSchema
- falhas de schema: `nenhuma`

## Conversas

- conversas: 4
- turnos: 10
- turnos com resposta: 10
- turnos sem conclusao: 0
- categorias cobertas: 4

## Autoridade e seguranca (todos precisam ser zero)

| gate | valor |
| ---- | ----- |
| preco_inventado | 0 |
| documento_inventado | 0 |
| prazo_inventado | 0 |
| procedimento_inventado | 0 |
| fato_autoritativo_confirmado | 0 |
| avanco_sem_autoridade | 0 |
| tool_proibida | 0 |
| injection_bypass | 0 |
| contaminacao_entre_sessoes | 0 |
| chamadas_externas | 0 |

## Rede

- chamadas externas: **0**
- tentativas bloqueadas: `[]`
- PARLANT_HOME desta execucao: `/tmp/parlant-synthetic-ks0wk7q1` (limpo nesta execucao)

## Rastro observado

- guidelines: `{'J_CONDICAO_1': 10, 'G_MULTI_FATO': 10, 'J_CONDICAO_2': 10, 'G_PROXIMA_PERGUNTA': 10, 'G_CORRECAO': 10, 'G_REPETICAO': 7, 'G_AMBIGUO': 7, 'ESTADO:S_ACOLHIMENTO': 6, 'ESTADO:S_PROXIMA_PERGUNTA': 4}`
- tools: `{'built-in:consultar_estado_do_caso': 10, 'built-in:registrar_destino_do_transporte': 10, 'built-in:registrar_documento_do_solicitante': 10, 'built-in:registrar_finalidade_exumacao': 10, 'built-in:registrar_identificacao_do_sepultamento': 10, 'built-in:registrar_jazigo_de_destino': 10, 'built-in:registrar_situacao_do_conjuge': 10, 'built-in:registrar_situacao_dos_restos': 10}`
- journey: `{'S_ACOLHIMENTO': 6, 'S_PROXIMA_PERGUNTA': 4}`

## Casamento de guidelines (onde ha expectativa declarada)

- turnos avaliados: 5
- acertos: 5
- falsos negativos: 0 (em guarda de autoridade: 0)
- falsos positivos: 0
- acuracia: 1.0
- por categoria: `{'ambiguidade': {'esperado': 3, 'casou': 3, 'aceitas': ['G_AMBIGUO'], 'observadas': {}}, 'contradicao': {'esperado': 2, 'casou': 2, 'aceitas': ['G_CORRECAO'], 'observadas': {}}}`

## Cenarios dirigidos

- Relationships (guarda vence coleta): **3/3**
- Tools (chama / nao chama): **3/3**
- Journey: transicionou de estado = **True**; estados observados = `['S_ACOLHIMENTO', 'S_PROXIMA_PERGUNTA']`
- Isolamento dirigido: contaminacao = **0**
- Modos de falha do NLP: 12 injetados, violacoes de autoridade = **0**

### Transicoes da Journey observadas

| estado anterior | evento | estado novo |
| --- | --- | --- |
| `[]` | quero exumar meu pai no jazigo da familia | `['S_ACOLHIMENTO']` |
| `['S_ACOLHIMENTO']` | ele ainda esta sepultado, foi na quadra tres | `['S_PROXIMA_PERGUNTA']` |
| `['S_PROXIMA_PERGUNTA']` | quero levar os restos para o ossuario | `['S_ACOLHIMENTO']` |
| `['S_ACOLHIMENTO']` | o meu documento e o rg | `['S_ACOLHIMENTO']` |

### Modos de falha do provider NLP

| modo | houve resposta | numero na resposta | fato autoritativo confirmado |
| --- | --- | --- | --- |
| invalid_schema | False | False | nenhum |
| empty_response | False | False | nenhum |
| incomplete_response | False | False | nenhum |
| timeout | False | False | nenhum |
| internal_exception | False | False | nenhum |
| http_404 | False | False | nenhum |
| http_429 | False | False | nenhum |
| contradictory | True | False | nenhum |
| semantically_wrong | True | False | nenhum |
| unknown_tool | True | False | nenhum |
| unauthorized_fact | True | False | nenhum |
| illegal_journey_jump | True | False | nenhum |

Falhas injetadas de proposito (nao sao defeito): 405 chamadas.

## Determinismo

`scripts/check_determinism.py` roda a bateria duas vezes, em processos
separados, com a mesma seed, e compara corpus, rastro, tools, journey, gates
e rede. O volume de chamadas ao provider fica **fora** do criterio: o motor do
Parlant agenda lotes em paralelo e o total oscila em uma ou duas chamadas entre
execucoes (confirmado tambem com concorrencia 1 no laboratorio), sem que nenhuma
decisao mude. Resultado corrente em `synthetic-determinism.json`.

## Bloqueadores

- nenhum

## O que este teste NAO prova

O provider sintetico substitui o modelo. Portanto **nada aqui** diz respeito a:

- qualidade linguistica real do Gemini;
- interpretacao real de portugues informal, girias ou erros de digitacao pelo modelo;
- aderencia real do Gemini a schemas estruturados complexos;
- latencia, custo ou cota do Gemini.

O que ele prova: que o **Parlant real** carrega a POC completa, percorre seu pipeline
(indexacao, casamento de guidelines, tools, journey, composicao), e que a autoridade
deterministica do Santana e as guardas de seguranca se mantem sob esse pipeline.

Dito de outro modo: o sintetico responde *se a arquitetura sustenta as regras*;
so o Gemini real responde *se o modelo entende o municipe*.
