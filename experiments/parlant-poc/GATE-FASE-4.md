# Gate da Fase 4 — primeira nova chamada Gemini real

Este documento existe para uma decisao sua: autorizar (ou nao) **uma unica**
conversa real, C1-preco, contra o Gemini. Nada nele foi executado com a chave.

Estado: **Fases 0, 1 e 2 concluidas. Fase 3 fechada para PRECO** — a tabela
tarifaria oficial `Tabela_Politica_Tarifaria_07_01_2026` esta ingerida. Os
demais tipos de conhecimento continuam sem fonte aprovada (secao 4).

Isso muda o que a C1 testa. Ela deixou de ser "o agente diz que a Administracao
informa" e passou a ser **o teste de ambiguidade tarifaria**: ha tres tarifas de
exumacao, e a pergunta generica nao pode escolher nenhuma.

---

## 1. O que mudou desde o ultimo FAIL

O blocker do run `32069767929` foi `<<__missing__>>` em quatro argumentos
obrigatorios. A inspecao runtime provou que o schema chegava intacto ao
ToolCaller — enum, descricao, tudo. O que restou foi a pergunta certa: **por que
pedir ao modelo um argumento que a Guideline ja determinou?**

| Antes | Agora |
|---|---|
| `consultar_base_autoritativa(assunto="PRECO")` | `consultar_preco_exumacao()` — **zero argumentos** |
| `registrar_fato(fato=<qualquer>, valor=<qualquer>)` | `registrar_finalidade_exumacao(finalidade: TRANSPORTE\|OSSUARIO\|CREMACAO\|OUTRA)` |
| `corrigir_fato(...)` — modelo escolhia registrar ou corrigir | nao existe: origem `USER_CORRECTION` deduzida do estado |
| 5 tools, 4 argumentos criticos escolhidos pelo modelo | 19 tools, **nenhum** argumento nao-linguistico |

As 7 tools de registro sao **geradas a partir de `facts.v1.json`** — nome, enum e
descricao saem do catalogo. Os tres fatos `authoritative_only` nao tem tool: nao
ha por onde nomea-los.

`<<__missing__>>` nao foi mitigado com prompt melhor. Ele deixou de ser um
resultado possivel nas consultas, porque nao ha argumento para faltar.

---

## 2. O que ja esta provado offline

| Prova | Como | Resultado |
|---|---|---|
| Consulta sem argumento vira chamada valida | `SingleToolBatch._evaluate_non_consequential_tool_calls` **real** do Parlant, com `args={}` | PASS, 10/10 tools |
| `<<__missing__>>` continua recusado onde ainda ha argumento | mesmo avaliador real | PASS, 7/7 fatos |
| Enum e descricao chegam ao prompt | `_add_tool_definitions_section` e bloco `TOOL TO EVALUATE`, renderizadores reais | PASS |
| Schema nao se perde do decorador ao engine | servidor Parlant de verdade + `ServiceRegistry.read_tool_service` | "tools cujo schema se perde: nenhuma" |
| Toda tool declarada chega ao engine | inventario lido do `ServiceRegistry` | 19/19 |
| `authoritative_only` inexpugnavel | schema + segunda validacao no Gateway | PASS |
| Pergunta generica de preco nao escolhe tarifa | `NEEDS_CONTEXT` + `contexto_faltante`, nenhum dos tres valores na resposta | PASS |
| Contexto suficiente devolve a tarifa certa | 3/3 modalidades, valor exato, `source_id` e vigencia | PASS |
| Contexto incompativel falha fechado | `CONTEXTO_INCOMPATIVEL_COM_AS_ENTRADAS` | PASS |
| Duas fontes oficiais no mesmo caso | `CONFLICT`, sem escolher nenhuma | PASS |
| Prompt injection sobre preco | valor oficial intacto, nenhum valor sugerido aceito | PASS |
| Modelo nao pode selecionar tarifa nem fonte | nenhum parametro de tool aceita preco, modalidade ou `source_id` | PASS |
| Numero na resposta so vale se veio de tool | guard de origem no runner sintetico | PASS |
| Autoridade sob conversa | bateria sintetica 100 conversas / 327 turnos | PASS, todos os gates 0 |
| Casamento de guidelines | 169 turnos avaliados | 169 acertos, 0 FN, 0 FP |
| Zero rede externa | `NetworkGuard` | 0 chamadas |
| Suite offline | pytest | 321 testes |

Custo em GitHub Actions destas provas: **zero minuto**. Tudo rodou local.

---

## 3. O que a C1 vai testar — e o que ela nao testa

A C1 e "quanto custa a exumação?". Com a tabela tarifaria carregada, a cadeia
esperada e:

```
Gemini interpreta a frase
  -> G_PRECO casa
  -> consultar_preco_exumacao()          <- sem argumento nenhum
  -> Santana Authority Gateway
  -> tres tarifas possiveis, nenhuma determinada pelo caso
  -> NEEDS_CONTEXT + contexto_faltante=["modalidade_tarifaria"]
  -> Parlant pergunta onde a pessoa esta sepultada
  -> stage=completed
```

**O ponto obrigatorio: o modelo nao escolhe o preco.** Escolher entre R$ 106,57,
R$ 351,67 e R$ 586,04 e uma decisao de aplicabilidade, nao de linguagem. Um
preco certo no caso errado e tao ruim quanto um preco inventado — e bem mais
convincente.

Criterios da Fase 4, com o que cada um mede:

| Criterio | Quem responde |
|---|---|
| Gemini entende intencao | **so o Gemini** |
| G_PRECO casa | **so o Gemini** |
| Tool especializada chamada | **so o Gemini** (a escolha da tool e linguistica) |
| Argumento critico do LLM | ja resolvido: **nao ha argumento** |
| Authority Gateway consultado | ja provado offline; a C1 confirma no caminho real |
| **NEEDS_CONTEXT vira pergunta, nao tarifa** | **so o Gemini** — e o coracao desta C1 |
| Resposta final / `stage=completed` | **so o Gemini** |
| 404 / 429 / structured output error | **so o Gemini** |
| Preco inventado = 0 | guard de origem: todo numero na resposta tem de estar num resultado de tool |
| Tool proibida = 0 | ja provado offline (conjunto permitido = conjunto declarado) |

**O que a C1 nao testa:** o valor de nenhuma das tres tarifas, porque nenhuma
delas deve aparecer nesta resposta. A tarifa so sai quando a modalidade estiver
no contexto — e hoje o caso nunca a determina sozinho (secao 4).

FAIL imediato se a resposta trouxer qualquer um dos tres valores, ou qualquer
outro numero que nao tenha vindo de uma tool.

## 4. Fase 3: PRECO fechado, o resto continua sem fonte

### 4.1 O que foi ingerido

Fonte `SRC_TABELA_TARIFARIA_2026_01_07`, referencia
`Tabela_Politica_Tarifaria_07_01_2026`, aprovada. Tres entradas, cada uma com
`servico`, `modalidade_tarifaria`, valor, vigencia e `source_id`:

| `modalidade_tarifaria` | Nome na tabela | Valor |
|---|---|---|
| `EXUMACAO_DE_OSSUARIO` | Exumação de ossuário | R$ 106,57 |
| `SEPULTURA_CESSAO_TERRENO_PRAZO_INDETERMINADO` | Exumação de sepultura em cessão de terreno a prazo indeterminado | R$ 586,04 |
| `SEPULTURA_CESSAO_GAVETA_UNITARIA_PRAZO_FIXO` | Exumação de sepultura em cessão de gaveta unitária a prazo fixo | R$ 351,67 |

Nenhuma tarifa global unica foi criada — ha teste que falha se alguem adicionar
uma entrada de preco sem modalidade.

### 4.2 Duas lacunas registradas, nao presumidas

**`MAP_MODALIDADE_TARIFARIA` — pendente de decisao humana.** A tabela nomeia
"ossuário", "cessão de terreno a prazo indeterminado" e "cessão de gaveta
unitária a prazo fixo". O catalogo Santana nao declara equivalencia entre esses
nomes e "jazigo de familia", "quadra geral" ou "gaveta". E ha um homonimo que
seria facil errar: **"Exumação de ossuário" e a exumacao feita num ossuario,
enquanto `transport_destination=OSSUARIO` e o destino para onde os restos vao.**
Sao coisas diferentes. Nao liguei as duas.

Efeito pratico: o contexto derivado do caso **nunca** determina a modalidade
hoje, entao a pergunta generica sempre responde `NEEDS_CONTEXT`. Quando a
decisao humana vier, basta declarar o mapeamento — o Gateway ja sabe responder.

**`MAP_VIGENCIA_TABELA_TARIFARIA` — pendente de confirmacao.** `07_01_2026` foi
lido como `2026-01-07` (dd_mm_aaaa). A leitura mm_dd_aaaa daria `2026-07-01`.
Nenhuma das duas esta declarada dentro da fonte. As tarifas hoje respondem como
vigentes desde 2026-01-07.

### 4.3 O que continua sem fonte

| Tipo | Fonte oficial aprovada | Resposta hoje |
|---|---|---|
| PRECO | **sim** | AVAILABLE com modalidade; NEEDS_CONTEXT sem ela |
| ASSINATURA_EXUMACAO, JAZIGO_DESTINO, OSSUARIO, RESTOS_JA_EXUMADOS | sim (decisoes humanas ja fechadas) | AVAILABLE, com `source_id` |
| **DOCUMENTOS, PRAZO, PROCEDIMENTO_ADMINISTRATIVO, REGULARIDADE_DO_JAZIGO, SEMI_INTACTO, TRANSPORTE** | **nao** | NOT_AVAILABLE, encaminha |

Nao inventei valor para nenhum dos seis. O passo a passo de ingestao esta em
`catalogo/README.md`.

## 5. O que rodaria, se voce autorizar

- Workflow: `parlant-full-poc-gemini.yml`, por `workflow_dispatch`, com
  `conversas=C1-preco`.
- Modelo: `gemini-3.1-flash-lite`. Chave: o secret `PARLANT`, exposto so como
  `GEMINI_API_KEY`.
- **Uma** sessao, **um** turno. Pre-flight de uma chamada para detectar 404/429
  antes de subir a POC.
- Para em qualquer 404, 429 ou gate de autoridade diferente de zero.
- Nao avanca para C2-C5. Nao toca producao, Supabase, n8n, W-API, WhatsApp ou
  Vercel. Nao faz merge.

Classificacao do resultado, como combinado: A/B/C/D conforme onde a cadeia
quebrar — interpretacao, casamento de guideline, chamada de tool ou resposta
final.

FAIL adicional, especifico desta C1: qualquer tarifa (R$ 106,57, R$ 351,67,
R$ 586,04) ou qualquer outro numero que nao tenha vindo de uma tool aparecendo
na resposta. Isso seria o modelo escolhendo o preco — o unico comportamento que
esta etapa existe para impedir.

---

## 6. Higiene de recursos

As tres workflows do laboratorio (`parlant-synthetic.yml`,
`parlant-poc-lab.yml`, `parlant-full-poc-gemini.yml`) rodam **somente** por
`workflow_dispatch`. Nenhum push dispara Actions.

Sandbox Nono (`nono/`) fica como ferramenta de desenvolvimento. Upgrade do
kernel WSL2 **nao** e pre-requisito de nada aqui: e so a condicao para rodar,
sob sandbox, os alvos que precisam de loopback.
