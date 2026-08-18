# Gate da Fase 4 — primeira nova chamada Gemini real

Documento de decisao para autorizar **uma unica** conversa real, C1-preco.
Nada aqui foi executado com a chave. Nenhum GitHub Actions foi disparado.

Estado: **Fase 4A concluida.** Os quatro problemas que impediram a C1 anterior
de chegar ao ToolCaller foram corrigidos offline.

---

## 1. Por que a C1 anterior falhou

Run `32146735829`, commit `620d282`. O tool calling **nunca foi exercitado**:

```
(nenhum lote de tool calling foi solicitado neste turno)
```

A aritmetica do run: `98 chamadas x 12 s = 1176 s`, contra 1180 s medidos.
`gemini-3.1-flash-lite` nao estava na tabela de RPM, caiu no fail-safe de 5 rpm,
e o run inteiro virou espera do limiter. A inicializacao levou 991,8 s
(`Evaluating entities` 15m17s) e o turno bateu em 188,15 s contra um teto de
180 s — estourou por 8 segundos.

O que ja estava certo e nao foi tocado: o Gemini entendeu a intencao, `G_PRECO`
casou, a prioridade sobre `G_COLETA` separou, nenhum fato indevido entrou, todos
os gates de autoridade ficaram em zero, e o schema de `consultar_preco_exumacao`
segue `parameters={}`, `required=[]`.

---

## 2. O que mudou na Fase 4A

### 2.1 RPM deixou de ser um numero inventado

A tabela `DEFAULT_RPM_BY_MODEL` tinha valores que ninguem mediu, e o modelo em
uso nao estava nela. Ela foi removida.

* `POC_GEMINI_RPM` e **configuracao explicita**. O caminho que gasta cota chama
  `exigir_rpm_declarado()` e **recusa rodar** sem ela.
* `RPM_FAIL_SAFE = 5` continua existindo, mas so como piso conservador para
  quem nao configurou nada — nunca mais como valor de trabalho silencioso.
* O workflow passou a ter `rpm` como **input obrigatorio sem default**. Nao ha
  valor medido para esta chave no projeto, entao nao inventei um.
* O throttle continua obrigatorio. Um 429 **encerra**: `POC_GEMINI_RETRIES_429`
  passou a valer 0 por padrao, em vez das 6 retentativas anteriores.

### 2.2 O timeout do turno passou a acompanhar o agente

Os 180 s foram calibrados com 14 guidelines e 5 tools. Hoje sao 20 e 19.

```
timeout = CHAMADAS_POR_TURNO_ESPERADAS (20) x (60/rpm) x MARGEM (2,0)
```

As 20 chamadas vem de medicao: a bateria sintetica de 300 conversas deu ~16
chamadas marginais por turno, e o run real bateu com isso (~15 chamadas em
188 s a 12 s cada). A 5 rpm o timeout vira 480 s; a 60 rpm, 40 s. Ele deixou de
ser um numero fixo que envelhece junto com o agente.

O relatorio agora decompoe o tempo: inicializacao, cada turno, **espera de
throttle** (`THROTTLE_STATS`), processamento efetivo, fracao em espera e tempo
por estagio do pipeline. Sem essa separacao, "o turno demorou 188 s" nao
distingue lentidao de rate limit — e no run anterior era a segunda coisa.

### 2.3 `PRECO_APLICAVEL` nao existe mais como resposta armazenada

O erro era estrutural:

```
CannedResponse field extraction: missing 'valor'
KeyError: "Missing field 'valor' in canned response"
```

O compositor do Parlant **pre-renderiza** as candidatas da guideline que casou,
antes de qualquer tool rodar. Uma resposta armazenada com `{{valor}}` e uma
armadilha: gasta uma chamada ao modelo e falha.

A inversao: a resposta que menciona valor **nasce da tool**, junto com o campo, e
so quando o Gateway devolve `AVAILABLE`. O Parlant trata resposta vinda de tool
como transiente e nao a submete ao filtro de campos.

| Estado do Gateway | Resposta | Menciona valor |
|---|---|---|
| `AVAILABLE` | transiente, via `ToolResult.canned_responses` + `canned_response_fields` | sim, e o valor vem do Gateway |
| `NEEDS_CONTEXT` | `PRECO_PRECISA_CONTEXTO`, armazenada | nao |
| `CONFLICT` | `PRECO_EM_CONFLITO`, armazenada | nao |
| `NOT_AVAILABLE` | `SEM_PRECO`, armazenada | nao |

A regressao que trava isso usa a funcao real do Parlant
(`canned_response_generator._get_response_template_fields`) e falha se **qualquer**
resposta armazenada passar a depender de campo que so uma tool fornece.

### 2.4 Cache de indexacao por `release_id`

`santana_parlant_poc/release.py`. O `release_id` deriva do conteudo — catalogo
oficial, catalogos de dominio e a configuracao do agente (guidelines,
relationships, journey, canned responses, glossario, schema das tools).

* Cache em `<raiz>/<release_id>`; releases diferentes nunca se cruzam.
* Mudanca material gera id novo, e o cache antigo deixa de ser **alcancavel** —
  e por isso que reaproveitar deixou de ser perigoso. Antes o home era limpo a
  cada run porque o `evaluation_cache.json` ja tinha congelado a Journey uma vez.
* Release so e publicada (`estado: pronta`) depois de indexada. Construcao
  interrompida, marcador ilegivel, marcador de outra release, diretorio sem
  marcador: **todos falham fechado**.
* `releases_disponiveis()` lista so as publicadas — e por elas que o rollback
  aponta para a anterior.
* Testes continuam podendo pedir home limpo (`limpo=True`,
  `FULL_POC_RELEASE_CACHE=0`).
* O cache **nao e fonte de autoridade**: nada nele responde preco, documento,
  prazo ou regra. Ha teste que falha se alguem escrever isso ali.

---

## 3. Micro-benchmark do cache

`scripts/bench_release.py`, provider sintetico, dois processos separados.

| | cold | warm |
|---|---|---|
| duracao | 0,56 s | 0,51 s |
| chamadas de geracao | 0 | 0 |
| operacoes de embedding | **27** | **0** |

Diferenca absoluta 0,05 s (11%). **Embeddings evitados: 27 (100%).**

**Limite honesto desta medicao.** O que esta medido e que o home da release
carrega estado reutilizavel entre boots: o warm refaz zero do trabalho de
embedding do cold. O que **nao** esta medido e a economia do lado da geracao —
com o provider sintetico `Evaluating entities` sai de graca e o
`evaluation_cache.json` termina com 2 bytes. Os 15m17s que essa etapa custou no
run real nao aparecem aqui, nem para mais nem para menos. **So um run real com a
mesma release mede isso**, e por isso nao afirmo que o cache resolve a
inicializacao — afirmo que ele existe, e isolado, falha fechado, e ja elimina o
trabalho que da para observar offline.

---

## 4. Testes offline

**362 testes, todos passando.** Os obrigatorios desta fase:

| # | Exigencia | Onde |
|---|---|---|
| 1 | suite completa PASS | 362 testes |
| 2 | `PRECO_APLICAVEL` nao gera KeyError sem campo | `test_canned_preco.py` |
| 3 | `AVAILABLE`: valor so do ToolResult/Gateway | `test_estado_available_entrega_valor_e_template_juntos` |
| 4 | `NEEDS_CONTEXT`: nenhuma resposta com valor e candidata | `test_estado_needs_context_nao_oferece_resposta_com_valor` |
| 5 | `CONFLICT`: nenhum preco escolhido | `test_estado_conflict_nao_escolhe_preco_nem_oferece_valor` |
| 6 | `NOT_AVAILABLE`: nenhum preco escolhido | `test_estado_not_available_nao_oferece_resposta_com_valor` |
| 7 | mesmo `release_id` reutiliza estado | `test_mesma_release_reaproveita_o_estado` |
| 8 | `release_id` diferente nao reutiliza | `test_release_diferente_nao_reaproveita_cache_anterior` |
| 9 | cache invalido/corrompido falha seguro | 4 testes de fail-safe |
| 10 | instrumentacao continua passiva | `test_a_instrumentacao_devolve_o_resultado_original_intacto` |
| 11 | gates de autoridade = 0 | bateria sintetica |

---

## 5. O que a C1 vai testar

```
Gemini interpreta "quanto custa a exumação?"
  -> G_PRECO casa
  -> consultar_preco_exumacao()          <- sem argumento nenhum
  -> Santana Authority Gateway
  -> tres tarifas possiveis, nenhuma determinada pelo caso
  -> NEEDS_CONTEXT + contexto_faltante=["modalidade_tarifaria"]
  -> resposta armazenada PRECO_PRECISA_CONTEXTO (sem {{valor}})
  -> stage=completed
```

FAIL imediato se aparecer qualquer tarifa (R$ 106,57, R$ 351,67, R$ 586,04) ou
qualquer numero que nao tenha vindo de uma tool — o guard de origem cobre isso.

**O modelo nao escolhe o preco.** Escolher entre tres tarifas reais e decisao de
aplicabilidade, nao de linguagem; e um preco certo no caso errado e tao ruim
quanto um inventado, so que mais convincente.

---

## 6. Configuracao do run, quando autorizado

| | |
|---|---|
| Workflow | `parlant-full-poc-gemini.yml`, `workflow_dispatch` |
| `conversas` | `C1-preco` |
| `rpm` | **voce precisa informar** — nao ha valor medido, e nao inventei um |
| Modelo | `gemini-3.1-flash-lite` |
| Timeout do turno | derivado do RPM |
| 429 | encerra sem retentar |
| Escopo | uma sessao, um turno. Nao avanca para C2-C5 |

Sem `rpm`, o smoke recusa rodar antes de gastar a primeira chamada.

---

## 7. Confirmacoes

* **Gemini nao foi usado** nesta fase.
* **GitHub Actions nao foi disparado** nesta fase.
* main intacta, sem merge, sem producao, sem n8n, W-API, WhatsApp, Supabase ou
  Vercel.
