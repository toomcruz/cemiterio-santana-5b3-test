# Validacao sintetica — Parlant real + Santana

**PARLANT SYNTHETIC VALIDATION: PASS**

- data: 2026-08-18T11:07:18+00:00
- parlant: 3.3.2
- commit: 07d475ff3356
- seed: 20260817
- provider: sintetico (sem LLM externo, sem secret)

## Inicializacao

- tempo ate o servidor no ar: **1.32s**
- duracao total da bateria: 294.3s
- entidades esperadas: `{'guidelines': 20, 'relationships': 16, 'journey_states': 5, 'tools': 19, 'canned_responses': 7, 'glossary_terms': 8}`
- entidades carregadas: `{'guidelines': 22, 'relationships': 21, 'journeys': 1, 'journey_states': 5, 'tools': 19, 'canned_responses': 7, 'glossary_terms': 8}`
- entidades faltando: `nenhuma`

## Schemas do Parlant

- encontrados nesta POC: **16**
- atendidos semanticamente: CannedResponseDraftSchema, CannedResponseFieldExtractionSchema, CannedResponsePreambleSchema, CannedResponseSelectionSchema, CustomerDependentActionSchema, GenericActionableGuidelineMatchesSchema, GenericObservationalGuidelineMatchesSchema, GenericResponseAnalysisSchema, GuidelineContinuousPropositionSchema, JourneyNextStepSelectionSchema, NonConsequentialToolBatchSchema, ReachableNodesEvaluationSchema
- atendidos estruturalmente: AgentIntentionProposerSchema, JourneyBacktrackCheckSchema, ReachableNodesEvaluationSchema, RelativeActionSchema, ToolRunningActionSchema
- falhas de schema: `nenhuma`

## Conversas

- conversas: 100
- turnos: 327
- turnos com resposta: 327
- turnos sem conclusao: 0
- categorias cobertas: 27

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
- PARLANT_HOME desta execucao: `/tmp/parlant-synthetic-1k3onj2e` (limpo nesta execucao)

## Rastro observado

- guidelines: `{'G_PROXIMA_PERGUNTA': 209, 'G_MULTI_FATO': 205, 'G_CORRECAO': 205, 'J_CONDICAO_1': 205, 'J_CONDICAO_2': 205, 'ESTADO:S_ACOLHIMENTO': 176, 'G_REPETICAO': 147, 'G_AMBIGUO': 147, 'ESTADO:S_PROXIMA_PERGUNTA': 105, 'G_INJECAO': 38, 'G_DOCUMENTOS': 25, 'G_PRECO': 25, 'G_PRAZO': 17, 'G_ASSINATURA': 13, 'G_PROCEDIMENTO': 13, 'G_FORA_DE_ESCOPO': 4}`
- tools: `{'built-in:consultar_estado_do_caso': 209, 'built-in:registrar_destino_do_transporte': 205, 'built-in:registrar_documento_do_solicitante': 205, 'built-in:registrar_finalidade_exumacao': 205, 'built-in:registrar_identificacao_do_sepultamento': 205, 'built-in:registrar_jazigo_de_destino': 205, 'built-in:registrar_situacao_do_conjuge': 205, 'built-in:registrar_situacao_dos_restos': 205, 'built-in:consultar_documentos_exumacao': 25, 'built-in:consultar_preco_exumacao': 25, 'built-in:consultar_prazo_exumacao': 17, 'built-in:consultar_quem_assina_exumacao': 13, 'built-in:consultar_procedimento_exumacao': 13, 'built-in:registrar_assunto_fora_de_escopo': 4}`
- journey: `{'S_ACOLHIMENTO': 176, 'S_PROXIMA_PERGUNTA': 105}`

## Casamento de guidelines (onde ha expectativa declarada)

- turnos avaliados: 169
- acertos: 169
- falsos negativos: 0 (em guarda de autoridade: 0)
- falsos positivos: 0
- acuracia: 1.0
- por categoria: `{'ambiguidade': {'esperado': 8, 'casou': 8, 'aceitas': ['G_AMBIGUO'], 'observadas': {}}, 'contradicao': {'esperado': 10, 'casou': 10, 'aceitas': ['G_CORRECAO'], 'observadas': {}}, 'correcao': {'esperado': 14, 'casou': 14, 'aceitas': ['G_CORRECAO'], 'observadas': {}}, 'pergunta_documentos': {'esperado': 8, 'casou': 8, 'aceitas': ['G_DOCUMENTOS'], 'observadas': {'G_DOCUMENTOS': 8}}, 'prompt_injection': {'esperado': 19, 'casou': 19, 'aceitas': ['G_INJECAO'], 'observadas': {'G_INJECAO': 19}}, 'tentativa_inventar_documento': {'esperado': 15, 'casou': 15, 'aceitas': ['G_DOCUMENTOS', 'G_INJECAO'], 'observadas': {'G_DOCUMENTOS': 15}}, 'tentativa_inventar_prazo': {'esperado': 12, 'casou': 12, 'aceitas': ['G_INJECAO', 'G_PRAZO'], 'observadas': {'G_INJECAO': 12}}, 'tentativa_inventar_preco': {'esperado': 15, 'casou': 15, 'aceitas': ['G_INJECAO', 'G_PRECO'], 'observadas': {'G_INJECAO': 7, 'G_PRECO': 8}}, 'mudanca_de_assunto': {'esperado': 4, 'casou': 4, 'aceitas': ['G_FORA_DE_ESCOPO'], 'observadas': {'G_FORA_DE_ESCOPO': 4}}, 'multiplas_informacoes': {'esperado': 10, 'casou': 10, 'aceitas': ['G_DOCUMENTOS', 'G_MULTI_FATO'], 'observadas': {'G_DOCUMENTOS': 2}}, 'pergunta_prazo': {'esperado': 17, 'casou': 17, 'aceitas': ['G_PRAZO'], 'observadas': {'G_PRAZO': 17}}, 'pergunta_preco': {'esperado': 17, 'casou': 17, 'aceitas': ['G_PRECO'], 'observadas': {'G_PRECO': 17}}, 'regra_administrativa': {'esperado': 9, 'casou': 9, 'aceitas': ['G_ASSINATURA', 'G_JAZIGO_DESTINO', 'G_PROCEDIMENTO'], 'observadas': {'G_ASSINATURA': 9, 'G_PROCEDIMENTO': 9}}, 'repeticao': {'esperado': 11, 'casou': 11, 'aceitas': ['G_REPETICAO'], 'observadas': {}}}`

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
