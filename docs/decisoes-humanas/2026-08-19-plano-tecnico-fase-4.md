# Plano técnico da Fase 4 — executável, sem implementação

```
DATA          2026-08-19
NATUREZA      PLANO. Nao e decisao humana, nao e implementacao.
BASE          docs/decisoes-humanas/2026-08-19-auditoria-cruzada-pre-fase-4.md
              docs/decisoes-humanas/2026-08-19-fechamento-p1-p6.md
              SHA b1d0c38acedc1d343426303b42f81ff0035440b8
ENTRADA       DECISOES_HUMANAS_PENDENTES = 0
              CONTRADICOES EM ABERTO     = 0
              GAPS                       = 20
              PRE_PHASE_4_GATE           = PASS
FASE 4        NAO INICIADA
```

Este documento **planeja**. Não altera catálogo, domínio, schemas, contratos,
enums, vetores, Gateway, referência Python, Supabase, n8n, workflows nem
`release_id`. Nenhuma linha de código foi escrita.

---

# 0. O achado que organiza o plano — a fronteira do `release_id`

Antes de ordenar qualquer coisa, é preciso saber o que custa caro. E o que custa
caro está declarado em `santana-authority-gateway/catalogo/carregar.ts`:

```ts
/** Ordem alfabetica - a mesma que o `sorted()` da referencia produz. */
export const ARQUIVOS_DE_DOMINIO = [
  "facts.v1.json",
  "goals.v1.json",
  "questions.v1.json",
  "relations.v1.json",
  "topics.v1.json",
] as const;
```

O `release_id` é `sha256(catálogo oficial ‖ os cinco arquivos acima)`. Portanto:

```
DENTRO DA FRONTEIRA  -> qualquer byte alterado muda o release_id
                        e torna INVALIDO cada um dos 47 casos V1-V12

  santana-authority/catalogo/exumacao.v1.json
  santana-conversation-domain/facts.v1.json
  santana-conversation-domain/goals.v1.json
  santana-conversation-domain/questions.v1.json
  santana-conversation-domain/relations.v1.json
  santana-conversation-domain/topics.v1.json

FORA DA FRONTEIRA    -> pode evoluir sem tocar no release_id

  santana-conversation-domain/state.schema.json
  santana-conversation-domain/conversation-events.v1.json
  santana-conversation-domain/engine/*.ts
  santana-conversation-domain/runtime/**
  santana-authority-gateway/**   (leitor, nao dono do conhecimento)
  referencia/**
  conformidade/perfis/**
  docs/**
```

**Consequência que redefine o plano:** a maior parte do trabalho estrutural —
solicitação, sessão, documentos, reclassificação, ações — vive **fora** da
fronteira. Só a origem, os eixos de restos, a Administração Provisória, o
fallback e os componentes de cobrança vivem **dentro**.

Logo, o plano faz **um único bump de `release_id`**, no fim, com todas as
mudanças de conhecimento agrupadas. A alternativa — mudar o domínio a cada
subfase — obrigaria a reconformar os 47 casos cinco ou seis vezes, e cada
reconformidade é uma oportunidade de acomodar vetor a código, que é exatamente o
que a governança do projeto proíbe.

```
UM BUMP, NO FIM.  NAO SEIS BUMPS PELO CAMINHO.
```

---

# 1. Inventário técnico dos gaps G01–G20

Legenda das colunas: **REL** altera `release_id` · **MIG** exige migração ·
**CTR** exige contrato novo/alterado · **VET** exige vetor de conformidade ·
**GTW** exige atualizar o Gateway TS/Deno · **PY** exige atualizar a referência
Python · **DOM** exige mudar o domínio conversacional · **PER** exige mudança de
persistência · **INT** exige integração futura Supabase/n8n.

| GAP | Problema | Dependências | Artefatos afetados | Risco | REL | MIG | CTR | VET | GTW | PY | DOM | PER | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **G01** | solicitação não existe como objeto | — | `state.schema.json`, `engine/persistence*.ts` | CRITICAL | não | sim | **sim** R7 | não | não | não | fora da fronteira | **sim** | depois |
| **G02** | seis formas de criar solicitação, duas com `creates_case: false` | G01 | `goals.v1.json`, `engine/engine.ts` | CRITICAL | **sim** | sim | sim | **sim** | não | não | **sim** | sim | depois |
| **G03** | reclassificação sem perda de contexto | G17 | `conversation-events.v1.json`, `state.schema.json`, `engine/engine.ts` | CRITICAL | não | sim | **sim** R8 | não | não | não | fora da fronteira | sim | não |
| **G04** | documentos sem identidade nem estado | G01 | `state.schema.json`, `engine/persistence*.ts` | HIGH | não | sim | sim | não | não | não | fora da fronteira | **sim** | depois |
| **G05** | Administração Provisória não existe como instrumento | G01, G04 | `facts.v1.json`, `relations.v1.json`, `questions.v1.json`, `state.schema.json` | CRITICAL | **sim** | sim | sim | **sim** | não | não | **sim** | sim | depois |
| **G06** | eixos de restos colapsados | G20 | `facts.v1.json`, `relations.v1.json` | HIGH | **sim** | não | não | **sim** | não | não | **sim** | não | não |
| **G07** | preferência ≠ solicitação ≠ confirmação de agenda | G01, G10 | `facts.v1.json`, `state.schema.json`, catálogo de ações | HIGH | **sim** | sim | sim | **sim** | não | não | **sim** | sim | depois |
| **G08** | componentes de cobrança não representáveis | G19, G20 | `exumacao.v1.json`, `catalogo/carregar.ts`, `consulta.ts`, referência Python | HIGH | **sim** | não | **sim** R9 | **sim** | **sim** | **sim** | não | não | não |
| **G09** | `fallback: true` sem condição de disparo | G17 | `topics.v1.json`, `engine/engine.ts` | HIGH | **sim** | não | sim | **sim** | não | não | **sim** | não | não |
| **G10** | destinatários de encaminhamento não existem | G01 | catálogo de ações novo, `state.schema.json` | HIGH | **ver 4F** | sim | **sim** R10 | não | não | não | fora se em artefato próprio | sim | depois |
| **G11** | sessão e processo sem vínculo declarado | G01 | `state.schema.json`, `docs/blueprint-binding.md`, `engine/persistence*.ts` | HIGH | não | sim | **sim** R11 | não | não | não | fora da fronteira | **sim** | **sim** |
| **G12** | assunto legível da solicitação | G01 | `state.schema.json`, regra de composição no motor | CRITICAL | não | sim | sim | não | não | não | fora da fronteira | sim | depois |
| **G13** | ciclo de acompanhamento pós-venda | G01, G10 | `state.schema.json`, `engine/engine.ts` | MEDIUM | não | sim | não | não | não | não | fora da fronteira | sim | depois |
| **G14** | portão/tranca e reforma fora de `commercial_item` | G20 | `facts.v1.json` | LOW | **sim** | não | não | sim | não | não | **sim** | não | não |
| **G15** | localização física (Bloco I) não existe | G20 | `facts.v1.json` | LOW | **sim** | não | não | sim | não | não | **sim** | não | não |
| **G16** | precedência da primeira mensagem sobre o menu | G17 | `engine/engine.ts`, `runtime/interpreter/**` | MEDIUM | não | não | sim | não | não | não | fora da fronteira | não | **sim** |
| **G17** | tópico não é armazenado, só derivado | — | `state.schema.json` | MEDIUM | não | sim | sim | não | não | não | fora da fronteira | sim | não |
| **G18** | pergunta de preço comercial sem rota informativa | G01, G17 | `goals.v1.json`, `engine/engine.ts` | MEDIUM | **sim** | não | não | **sim** | não | não | **sim** | não | não |
| **G19** | proveniência: decisão humana não é tipo de fonte | — | `exumacao.v1.json` (`fontes[]`), `catalogo/carregar.ts`, referência Python | HIGH | **sim** | não | **sim** R12 | **sim** | **sim** | **sim** | não | não | não |
| **G20** | origem administrativa como eixo próprio | — | `facts.v1.json`, `questions.v1.json`, `relations.v1.json`, `conformidade/perfis/` | HIGH | **sim** | não | sim | **sim** | não | não | **sim** | não | não |

## Contagem de impacto

```
ALTERAM release_id     G02 G05 G06 G07 G08 G09 G14 G15 G18 G19 G20   11
NAO ALTERAM            G01 G03 G04 G10* G11 G12 G13 G16 G17           9
EXIGEM MIGRACAO                                                       9
EXIGEM CONTRATO NOVO   R7 R8 R9 R10 R11 R12                           6
EXIGEM VETOR NOVO                                                    10
TOCAM O GATEWAY        G08 G19                                        2
TOCAM A REFERENCIA PY  G08 G19                                        2
```

`*` `G10` fica fora da fronteira **se** o catálogo de ações for um artefato
próprio; entra na fronteira se as ações forem declaradas dentro de
`facts.v1.json` / `questions.v1.json`, como as quatro atuais. A escolha é da
subfase 4F e está justificada lá.

**Observação importante sobre Gateway e referência Python:** apenas `G08` e
`G19` os tocam. Os dois são leitores do catálogo autoritativo, não donos de
estado conversacional — o resto do trabalho da Fase 4 não os alcança. Isso
mantém a conformidade Python × TS/Deno estável durante quase todo o plano.

---

# 2. Priorização técnica definitiva

## O que a auditoria já havia estabelecido, e que é preservado

| Regra da auditoria | Preservada? | Onde |
|---|---|---|
| `G01` + `G12` no início | **sim** | 4B |
| `G11` cedo | **sim** | 4C |
| `G17` antes de `G03` | **sim** | 4D — `G17` abre a subfase, `G03` fecha |
| `G19` e `G20` antes da publicação dos valores | **sim** | 4G/4H, ambos antes de 4I |
| `G08` só com a base estável | **sim** | 4H, penúltima subfase técnica |

## O que muda, e por quê

**Mudança 1 — as subfases são agrupadas pela fronteira do `release_id`, não por
tema.**

A auditoria ordenou por dependência conceitual. O plano mantém essa ordem, mas
insere um corte: **tudo que está fora da fronteira acontece primeiro**, e tudo
que está dentro é agrupado em 4G–4I. Justificativa técnica: cada travessia da
fronteira custa uma reconformidade completa dos 47 casos e uma execução do
`comparar.py` byte a byte entre Python e TS/Deno. Seis travessias custam seis
reconformidades; uma travessia custa uma.

**Mudança 2 — `G09`, `G06`, `G07` e `G18` descem para o lote de domínio.**

A auditoria os colocava nas posições 7 e 8. Todos tocam `topics.v1.json`,
`facts.v1.json` ou `goals.v1.json`, logo estão **dentro** da fronteira. Mantê-los
antes de 4G forçaria um bump intermediário sem benefício. As partes de **motor**
desses gaps — a condição de disparo do fallback, a máquina de estados de
agendamento, o roteamento informativo — são implementadas antes, em 4D/4F, contra
os enums que ainda não existem; os enums entram no lote.

**Mudança 3 — `G07` é dividido.**

O eixo de estado (`REQUESTED` / `CONFIRMED`, com autoridade humana) é objeto de
solicitação e vive fora da fronteira → 4F. O enum de fato que o alimenta vive em
`facts.v1.json` → 4G. Dividir evita que uma decisão de fronteira arraste um gap
inteiro para o lote.

**Mudança 4 — nasce uma subfase 4A que não existia.**

Antes de qualquer alteração, a fronteira do `release_id` precisa estar
**declarada e testada**. Hoje ela existe apenas como comentário em
`carregar.ts` e como uma asserção de valor literal em
`garantias_test.ts`. Um teste que falhe quando alguém altera um dos cinco
arquivos sem intenção é a defesa mais barata do plano inteiro.

## Ordem final

```
4A  fundacoes e guarda da fronteira        —            fora
4B  solicitacao e assunto real             G01 G12 G02* fora
4C  sessao x processo                      G11          fora
4D  topico, reclassificacao, 1a mensagem   G17 G03 G16  fora
4E  documentos                             G04          fora
4F  autoridade, acoes e acompanhamento     G10 G13 G07a G18a  fora
--------------------------------------------------- fronteira do release_id
4G  lote de dominio                        G20 G06 G07b G05 G09 G18b G02b G14 G15
4H  proveniencia e componentes             G19 G08
4I  release unico e reconformidade         (nenhum novo)
4J  testes integrados e gates de producao  (nenhum novo)
```

`*` `G02` tem parte fora (o mecanismo de protocolar, 4B) e parte dentro (o
`creates_case` dos goals, 4G).

---

# 3–4. As subfases

Cada subfase segue o mesmo formulário. **Nenhuma delas admite "funcionou
manualmente" como evidência**: todo gate de saída é um comando que o CI executa.

O pipeline de referência é `.github/workflows/shadow-static.yml`, que hoje roda,
nesta ordem: `actionlint` · `deno fmt --check` · `deno lint` · `deno check` ·
`deno test tests/unit tests/shadow` · P0 conversacional · P0 de linguagem ·
roundtrip dos arquivos gerados · vetores na referência Python · testes da
referência com mutações · vetores no Gateway TS/Deno · testes do Gateway ·
`conformidade/comparar.py` byte a byte · verificações Postgres · secret scan.

**Chamamos `STATIC_PASS` a execução verde desse job.** É o gate de saída mínimo
de toda subfase.

---

## FASE 4A — Fundações e guarda da fronteira

**Objetivo.** Tornar a fronteira do `release_id` explícita, testada e difícil de
cruzar por acidente. Nenhuma mudança funcional.

| | |
|---|---|
| **Gaps resolvidos** | nenhum — habilita todos |
| **Arquivos esperados** | `santana-authority-gateway/tests/garantias_test.ts` (novo teste), `docs/fase4/FRONTEIRA-RELEASE.md` |
| **Mudanças permitidas** | acrescentar testes; acrescentar documentação |
| **Mudanças proibidas** | tocar qualquer um dos seis arquivos da fronteira; tocar `gateway.ts`, `consulta.ts`, `resposta.ts`; tocar vetores |
| **Pré-condições** | `STATIC_PASS` no `HEAD` de `main` |
| **Contratos afetados** | nenhum |
| **Schemas afetados** | nenhum |
| **Dados afetados** | nenhum |
| **Testes obrigatórios** | (a) teste que recalcula o `release_id` e falha se ≠ `exu-1.0-32cc48f26797`; (b) teste que enumera `ARQUIVOS_DE_DOMINIO` e falha se a lista mudar de tamanho ou ordem; (c) teste que afirma que `state.schema.json` e `conversation-events.v1.json` **não** entram no cálculo |
| **Vetores necessários** | nenhum |
| **Gate de entrada** | `STATIC_PASS` verde |
| **Gate de saída** | `STATIC_PASS` verde **e** `release_id` inalterado **e** os três testes novos passando |
| **Rollback** | `git revert` do commit; nenhum estado externo tocado |
| **PASS** | os três testes passam e `release_id == exu-1.0-32cc48f26797` |
| **FAIL** | qualquer teste novo falha, ou o `release_id` mudou — o que significaria que a subfase tocou a fronteira |

O teste (c) é o mais valioso do plano: ele **prova** que 4B–4F podem evoluir sem
reconformidade, em vez de o plano apenas afirmar isso.

---

## FASE 4B — Solicitação e assunto real

**Objetivo.** Criar a entidade de solicitação, com assunto legível, categoria,
motivo, encaminhamento e estado — **sem** um status único que esconda as
diferenças entre os seis casos.

| | |
|---|---|
| **Gaps resolvidos** | `G01`, `G12`, `G02` (parte fora da fronteira) |
| **Arquivos esperados** | `santana-conversation-domain/state.schema.json`, `santana-conversation-domain/engine/persistence.ts`, `engine/persistence_deps.ts`, `contracts/` (contrato R7), `docs/fase4/R7-SOLICITACAO.md` |
| **Mudanças permitidas** | acrescentar `$defs` e coleções a `state.schema.json`; acrescentar regras de composição no motor |
| **Mudanças proibidas** | tocar os seis arquivos da fronteira; alterar `subject_kind`/`subject_ref` do `case`; criar status único de solicitação; conectar Supabase |
| **Pré-condições** | 4A com gate de saída PASS |
| **Contratos afetados** | **novo R7 — Solicitação** |
| **Schemas afetados** | `state.schema.json` |
| **Dados afetados** | nenhum dado autoritativo |
| **Testes obrigatórios** | validação de schema; unitários de composição do assunto; teste de não-colapso (ver abaixo) |
| **Vetores necessários** | nenhum — solicitação está fora do escopo dos vetores V1–V12, que provam consulta autoritativa |
| **Gate de entrada** | teste (c) de 4A verde |
| **Gate de saída** | `STATIC_PASS` **e** `release_id` inalterado **e** o teste de não-colapso verde |
| **Rollback** | revert; o schema é aditivo, nada legado depende dele |
| **PASS** | os seis casos do §5 são distinguíveis por leitura do estado, sem inspecionar texto livre |
| **FAIL** | dois casos distintos produzem o mesmo estado observável |

### Desenho conceitual — sem unificação prematura

O objeto de solicitação precisa carregar, **em campos distintos**:

```
entidade relacionada   -> reaproveita case.subject_kind / subject_ref
assunto real           -> rotulo legivel, composto por regra (G12)
categoria              -> a natureza administrativa da solicitacao
topico                 -> topico-base no momento da abertura (G17)
overlay / natureza     -> reaproveita goal.overlay_of
resumo                 -> sintese da necessidade
motivo                 -> por que foi aberta
dados coletados        -> referencia aos facts, nao copia (isolation_rules)
pendencias             -> referencia a pending_question / pending_actions
encaminhamento         -> destinatario + executor (G10, subfase 4F)
estado                 -> ciclo PROPRIO DE CADA CATEGORIA
```

**A regra estrutural do R7:** *estado* não é um enum global. Cada categoria
declara o seu próprio ciclo. Os seis casos e seus ciclos, mantidos separados:

| Categoria | Ciclo próprio | Por que não pode fundir |
|---|---|---|
| venda | interesse → solicitação de contato → contato feito | não tem entrega |
| acompanhamento | aberto → em andamento → resolvido | pressupõe algo já vendido |
| reclamação | é **overlay**, não substitui a base | tem base obrigatória |
| solicitação de taxa | **solicitada** → **paga** | Concessão `A9` separa os dois deliberadamente |
| solicitação de agendamento | **pedida** → **confirmada por humano** | Exumação 17 e Transporte `A20` proíbem confundir |
| consulta | respondida ou encaminhada | pode não gerar solicitação (Outros `B1`) |
| encaminhamento à Administração | aberto → devolvido | precisa preservar o relato |

### O teste de não-colapso

Um teste tabular que constrói os sete casos acima e afirma que **nenhum par
produz o mesmo estado observável**. É o teste que impede o risco `R1` de voltar
por refatoração:

```
para todo par (a, b) de categorias distintas:
    estado_observavel(a) != estado_observavel(b)
```

### `G12` — composição do assunto, não texto livre

O rótulo é **derivado de fatos já confirmados**, por regra declarada, nunca
redigido pelo LLM:

```
commercial_item=LAPIDE + stage=PEDIDO_PAGO + delivery=PENDENTE
   -> "Lapide comprada e nao instalada"

other_subject_description presente, sem topico especializado
   -> "Duvida sobre <assunto informado>"
```

A regra de composição é **fail-closed**: sem fatos suficientes, o assunto cai
para o rótulo genérico e a solicitação registra que caiu. Isso respeita o R5
(léxico de apresentação é de mão única: código → texto) e mantém o LLM fora da
autoridade.

---

## FASE 4C — Sessão × processo

**Objetivo.** Declarar e testar a garantia `SESSION CLOSED != PROCESS CLOSED`.

| | |
|---|---|
| **Gaps resolvidos** | `G11` |
| **Arquivos esperados** | `state.schema.json`, `engine/persistence.ts`, `contracts/` (R8), `docs/fase4/R8-SESSAO-PROCESSO.md`, atualização de `docs/blueprint-binding.md` |
| **Mudanças permitidas** | declarar a fronteira entre sessão e processo; acrescentar referência de sessão ao estado |
| **Mudanças proibidas** | tocar a fronteira do `release_id`; implementar timers; chamar Supabase; alterar a política 3+2 |
| **Pré-condições** | 4B PASS |
| **Contratos afetados** | **novo R8 — Sessão × processo** |
| **Schemas afetados** | `state.schema.json` |
| **Dados afetados** | nenhum |
| **Testes obrigatórios** | o teste de sobrevivência (abaixo) |
| **Vetores necessários** | nenhum |
| **Gate de entrada** | 4B PASS |
| **Gate de saída** | `STATIC_PASS` **e** teste de sobrevivência verde **e** nenhuma chamada de rede no caminho testado |
| **Rollback** | revert; a política 3+2 permanece onde já está |
| **PASS** | fechar a sessão não altera nenhum byte de `cases`, `facts`, documentos ou solicitações |
| **FAIL** | qualquer objeto de processo muda ao fechar a sessão |

### Onde a separação deve viver

```
SESSAO                     conversation_sessions (Supabase)
                           ACTIVE -> WARNING_PENDING -> WARNING_SENT -> CLOSED
                           politica 3+2: worker 180 s / 120 s
                           JA EXISTE, nao e alterada por esta subfase

PROCESSO                   cases, facts, documentos, solicitacoes
                           state.schema.json
                           JA EXISTE parcialmente, ganha o vinculo aqui

VINCULO                    referencia de sessao no estado, unidirecional:
                           o processo sabe em que sessao foi tocado;
                           a sessao NAO e dona do processo
```

A direção do vínculo é a decisão técnica central: **unidirecional, do processo
para a sessão**. Se a sessão apontasse para o processo, fechar a sessão teria um
caminho natural para arrastar o processo junto — e é exatamente isso que a
garantia proíbe.

### Como será testado

```
1. abrir processo, registrar fatos e documentos
2. capturar hash do estado do processo
3. transicionar a sessao ACTIVE -> WARNING_PENDING -> WARNING_SENT -> CLOSED
4. recapturar o hash
5. assert hash_antes == hash_depois     <- a garantia
6. abrir NOVA sessao
7. assert o processo e recuperavel e retomavel do estado conhecido
```

O passo 5 é a garantia. O passo 7 é a retomada. Ambos rodam **sem rede** — a
transição de sessão é simulada pelo contrato, não pelo worker real. O worker real
entra em 4J.

---

## FASE 4D — Tópico, reclassificação e primeira mensagem

**Objetivo.** Armazenar o tópico, criar a operação de reclassificação sem perda
de contexto, e declarar a precedência da primeira mensagem.

| | |
|---|---|
| **Gaps resolvidos** | `G17`, `G03`, `G16` |
| **Arquivos esperados** | `state.schema.json`, `conversation-events.v1.json`, `engine/engine.ts`, `contracts/` (R9), `docs/fase4/R9-RECLASSIFICACAO.md` |
| **Mudanças permitidas** | acrescentar campo de tópico ao estado; **acrescentar** um `event_kind` ao enum de eventos |
| **Mudanças proibidas** | reaproveitar `NEW_GOAL`, `CORRECTION`, `CHANGE_OF_MIND` ou `UNCERTAIN`; alterar a semântica de qualquer evento existente; tocar a fronteira do `release_id` |
| **Pré-condições** | 4C PASS |
| **Contratos afetados** | **novo R9 — Reclassificação** |
| **Schemas afetados** | `state.schema.json` (campo de tópico), `conversation-events.v1.json` (novo evento) |
| **Dados afetados** | nenhum |
| **Testes obrigatórios** | teste de preservação; teste de não-reuso; P0 conversacional estendido |
| **Vetores necessários** | nenhum |
| **Gate de entrada** | 4C PASS |
| **Gate de saída** | `STATIC_PASS` **e** os dez eventos existentes com semântica byte-idêntica **e** `release_id` inalterado |
| **Rollback** | revert; o novo evento é aditivo e nenhum estado legado o emite |
| **PASS** | uma demanda migra de `OUTROS_ASSUNTOS` para um tópico especializado preservando todos os fatos e documentos, e o vínculo com a origem fica registrado |
| **FAIL** | qualquer fato ou documento se perde, ou o invariante de `NEW_GOAL` é acionado |

### `G03` — por que um evento novo, e não adaptação

A auditoria já demonstrou que os quatro candidatos falham por motivos
**diferentes**, e o `event_kind` é enum fechado. O plano acrescenta um evento
cuja semântica é declarada assim:

```
RECLASSIFICATION
  descricao   A mesma demanda passa a ser reconhecida como outro topico.
              Nao e novo objetivo, nao e correcao de fato, nao e mudanca
              de ideia e nao e incerteza sobre um fato.
  efeitos     update_topic(goal_atual)
              preserve_facts            <- explicito, nao implicito
              preserve_documents
              record_origin_topic       <- o vinculo de G03
  proibido    create_case
              supersede_fact
              reset_goal
  invariante  nenhum fact muda de status por efeito deste evento
```

O invariante é a diferença entre este evento e `NEW_GOAL`. **O teste de
não-reuso** afirma que a reclassificação **não** dispara
`create_case_when_subject_differs` nem o invariante *"nunca reutiliza facts de
outro case"* — porque não muda de case.

### `G16` — precedência da primeira mensagem

Regra declarada no motor, não no menu: se a primeira mensagem permite
identificar a intenção com segurança, ela é usada e **não** é substituída por
menu genérico. Compatível com `selection_rules` já existente
(`never_repeat_confirmed_active_fact`, `ask_first_the_fact_that_changes_the_next_decision`).
O teste usa fixtures de `runtime/fixtures/messages.v1.json`.

---

## FASE 4E — Documentos

**Objetivo.** Dar identidade e estado próprio aos documentos, com invalidação
seletiva.

| | |
|---|---|
| **Gaps resolvidos** | `G04` |
| **Arquivos esperados** | `state.schema.json`, `engine/persistence.ts`, `docs/fase4/DOCUMENTOS.md` |
| **Mudanças permitidas** | acrescentar coleção de documentos ao estado; ligar documento ↔ fato |
| **Mudanças proibidas** | tocar a fronteira; confundir "recebido" com "aceito"; permitir que o LLM aceite documento |
| **Pré-condições** | 4B PASS (documento pertence a uma solicitação ou a um case) |
| **Contratos afetados** | R7 (extensão) |
| **Schemas afetados** | `state.schema.json` |
| **Dados afetados** | nenhum |
| **Testes obrigatórios** | ciclo documental; sobrevivência a mudança de assunto; invalidação seletiva |
| **Vetores necessários** | nenhum |
| **Gate de entrada** | 4B PASS |
| **Gate de saída** | `STATIC_PASS` **e** os três testes verdes **e** `release_id` inalterado |
| **Rollback** | revert; aditivo |
| **PASS** | "recebido e recusado" é distinguível de "nunca enviado"; documento válido sobrevive a `PARALLEL_QUESTION` |
| **FAIL** | qualquer dos dois estados colapsa |

### Estados e a fronteira de autoridade

```
NAO_SOLICITADO -> SOLICITADO -> RECEBIDO -> ACEITO
                                        -> ILEGIVEL_OU_INADEQUADO -> SOLICITADO
                               PENDENTE (aguardando o municipe)
```

A transição **`RECEBIDO → ACEITO` é autoridade humana ou de sistema
autoritativo**, nunca do LLM. Isso decorre diretamente de
`authoritative_signal_policy`, que já rejeita `LLM_EXTRACTION` e `INFERENCE` como
confirmação. O teste afirma que nenhum caminho de código do LLM produz `ACEITO`.

### Invalidação seletiva

Quando um fato **estrutural** muda (origem, destino, titularidade), os documentos
que dependiam dele são invalidados; os demais **permanecem**. O mecanismo espelha
o que `CHANGE_OF_MIND` já faz com fatos —
`recompute_affected_dependencies_only`, com o invariante *"fatos nao dependentes
do fato alterado permanecem ACTIVE"*. O plano reaproveita a semântica, aplicada a
documentos.

---

## FASE 4F — Autoridade, ações e acompanhamento

**Objetivo.** Criar o catálogo de ações de encaminhamento, os estados de espera e
o ciclo de acompanhamento — preservando `requested != confirmed` e
`robot decision != human authority`.

| | |
|---|---|
| **Gaps resolvidos** | `G10`, `G13`, `G07` (parte de estado), `G18` (parte de motor) |
| **Arquivos esperados** | `santana-conversation-domain/actions.v1.json` (**novo artefato, fora da fronteira**), `state.schema.json`, `engine/engine.ts`, `contracts/` (R10), `docs/fase4/R10-AUTORIDADE.md` |
| **Mudanças permitidas** | criar catálogo de ações próprio; acrescentar `executor` e destinatário |
| **Mudanças proibidas** | declarar as ações novas dentro de `facts.v1.json` ou `questions.v1.json`; permitir que o robô confirme agenda; alterar `ai_boundary` |
| **Pré-condições** | 4B e 4E PASS |
| **Contratos afetados** | **novo R10 — Autoridade e encaminhamento** |
| **Schemas afetados** | `state.schema.json` |
| **Dados afetados** | nenhum |
| **Testes obrigatórios** | fronteira de autoridade; `requested != confirmed`; ciclo de acompanhamento |
| **Vetores necessários** | nenhum |
| **Gate de entrada** | 4E PASS |
| **Gate de saída** | `STATIC_PASS` **e** `release_id` inalterado **e** teste de autoridade verde |
| **Rollback** | revert; o novo catálogo é órfão sem o motor |
| **PASS** | nenhum caminho de código produz agendamento confirmado sem sinal humano |
| **FAIL** | existe caminho em que o robô confirma agenda, ou uma ação nova entrou na fronteira |

### Por que um artefato próprio para as ações

As quatro ações atuais vivem em `facts.v1.json` (`authoritative_signal_policy.actions`)
e `questions.v1.json` (`authoritative_resolutions`) — **dentro** da fronteira.
Acrescentar sete ações ali mudaria o `release_id` **sem que nenhum conhecimento
autoritativo tenha mudado**, e invalidaria os 47 vetores por um motivo que não é
de conhecimento.

O plano cria `actions.v1.json` como artefato próprio, fora da fronteira, com as
ações **novas** de encaminhamento e espera. As quatro existentes **permanecem
onde estão** — elas resolvem fatos autoritativos e pertencem legitimamente à
fronteira.

> **Consequência a aceitar conscientemente:** o catálogo de ações passa a ter
> duas casas. A alternativa — mover as quatro existentes para o novo arquivo —
> também muda o `release_id` e é mais invasiva. Se a Fase 4 preferir a casa
> única, ela deve acontecer **dentro do lote 4G**, e não antes.

### Ações planejadas — apenas planejadas

| Ação | `executor` | Origem funcional |
|---|---|---|
| abrir solicitação | `SYSTEM` | Outros `A3`, Concessão `A4`, Comercial `A2` |
| encaminhar à Administração | `SYSTEM_OR_HUMAN` | Outros `A3`, `B2` |
| encaminhar ao Setor de Concessões | `HUMAN` | Concessão `A1`, `A8`, `A10`, `A12` |
| solicitar contato comercial | `SYSTEM` | Comercial `A2` |
| solicitar acompanhamento | `SYSTEM` | Comercial `A3`/`A6`, Concessão `A12` |
| solicitar agendamento | `SYSTEM` | Exumação 17, Transporte `A20` |
| aguardar confirmação humana de agenda | **`HUMAN`** | Exumação 17, Transporte `A20` |

A última é a que sustenta `G07`: confirmar agenda é `executor: HUMAN`, sem
exceção. Não existe caminho `SYSTEM` para ela.

### `requested != confirmed`

```
PREFERENCIA declarada pelo municipe   fact, USER_EXPLICIT
        |
SOLICITACAO de agendamento            categoria propria de solicitacao (4B)
        |
AGENDAMENTO CONFIRMADO                exige acao com executor HUMAN
```

Três objetos, três donos. O teste percorre todos os caminhos de transição e
afirma que o terceiro é inalcançável sem sinal humano.

---

## FASE 4G — Lote único de domínio

**Objetivo.** Aplicar, **de uma vez**, todas as mudanças dentro da fronteira que
não são do catálogo autoritativo.

| | |
|---|---|
| **Gaps resolvidos** | `G20`, `G06`, `G07` (enum), `G05`, `G09`, `G18` (goal), `G02` (`creates_case`), `G14`, `G15` |
| **Arquivos esperados** | `facts.v1.json`, `goals.v1.json`, `questions.v1.json`, `relations.v1.json`, `topics.v1.json`, `conformidade/perfis/exumacao.v1.json` |
| **Mudanças permitidas** | acrescentar fatos, valores, goals, relações e regras de disparo |
| **Mudanças proibidas** | **publicar**; derivar modalidade do destino; inferir `QUADRA_GERAL` de número de quadra; colapsar `OSSUARIO`-origem com `OSSUARIO`-destino; usar `UNCERTAIN` como condição de fallback; colapsar AP em `recadastro_status` |
| **Pré-condições** | 4A–4F todas PASS |
| **Contratos afetados** | R1–R6 revalidados; nenhum novo |
| **Schemas afetados** | nenhum — os cinco arquivos são dados, não schema |
| **Dados afetados** | os cinco catálogos de domínio |
| **Testes obrigatórios** | P0 conversacional e de linguagem; validação estática do domínio; **os vetores rodam e resultam `INVALIDO`** |
| **Vetores necessários** | os novos são escritos aqui e **executados em 4I** |
| **Gate de entrada** | 4F PASS **e** um commit de fronteira declarado |
| **Gate de saída** | `STATIC_PASS` com os 47 casos em **`INVALIDO`**, não `FAIL` |
| **Rollback** | revert do lote inteiro — é um commit único por desenho |
| **PASS** | 47 casos `INVALIDO`, zero `FAIL`, P0 verde, `comparar.py` concordante entre Python e TS/Deno |
| **FAIL** | qualquer caso `FAIL`, ou P0 vermelho |

### A distinção que define o gate de saída

```
INVALIDO   o vetor nao rodou porque o conhecimento mudou   <- ESPERADO aqui
FAIL       o vetor rodou e a implementacao errou           <- NUNCA aceitavel
```

Esta é a única subfase do plano em que `INVALIDO` em massa é o resultado
**correto**. Os vetores congelados da Fase 2 **não são reescritos** — eles
permanecem como prova do release anterior.

### `G20` — origem como eixo próprio

Fato novo, domínio fechado, três valores conforme `P3`. Regras obrigatórias, todas
com teste:

```
1. origem NUNCA e derivada de transport_destination
2. origem NUNCA e derivada de numero de quadra ou localizacao
3. Quadra Geral 1/2/3 e LOCALIZACAO FISICA, eixo separado (G15)
4. origem conhecida pelo contexto -> reutilizar
5. origem ambigua -> perguntar em linguagem comum
6. municipe nao sabe -> verificacao interna, nao presumir
```

**Os identificadores finais não são decididos aqui por coincidência textual.** As
duas colisões registradas em `P3` — `OSSUARIO` como origem × destino, e
`OSSUARIO` × `RETIRADA_OU_DESATIVACAO_DE_OSSUARIO` — exigem desenho explícito
com justificativa escrita antes de qualquer identificador ser escolhido. O teste
correspondente afirma que **nenhuma regra lê o destino para produzir a origem**.

### `G05` — Administração Provisória

Representada como **instrumento com ciclo próprio**, jamais dentro de
`recadastro_status`:

```
INSTRUMENTO   titular, vigencia, vencimento, ordem (primeira/segunda), historico
TRANSICOES    instauracao -> vigente -> vencida
              troca voluntaria (GOV.BR do atual E do novo)
              desistencia
              falecimento -> sucessor
```

**Invariante testável:** `AP != Concessão`. Nenhuma transição de AP produz uma
concessão, e nenhum campo é compartilhado entre os dois. Este teste é a
mitigação declarada do risco `R2` — a proteção que hoje existe por ausência
passa a existir por asserção.

### `G09` — condição do fallback

Declarada em `topics.v1.json` e implementada contra o motor de 4D:

```
DISPARA   demanda entendida o suficiente E nao pertence com seguranca
          a nenhum topico especializado
NAO DISPARA   classificador inseguro
NAO E         UNCERTAIN (incerteza do municipe sobre um FATO)
```

O teste afirma que baixa confiança do classificador, isoladamente, **não** roteia
para `OUTROS_ASSUNTOS`.

---

## FASE 4H — Proveniência e componentes de cobrança

**Objetivo.** Estender o modelo de proveniência e representar componentes,
quantidade, condição de aplicação e total composto.

| | |
|---|---|
| **Gaps resolvidos** | `G19`, `G08` |
| **Arquivos esperados** | `santana-authority/catalogo/exumacao.v1.json`, `santana-authority-gateway/catalogo/carregar.ts`, `consulta.ts`, `referencia/santana_referencia/**`, `contracts/` (R11, R12) |
| **Mudanças permitidas** | acrescentar tipo de fonte; acrescentar componentes; publicar os cinco valores com vigência |
| **Mudanças proibidas** | **inventar portaria, decreto, URL ou documento**; criar tarifa monolítica para os totais; perder o contexto de aplicação de R$ 94,00; acrescentar R$ 94,00 em ossuário → jazigo |
| **Pré-condições** | 4G PASS |
| **Contratos afetados** | **novo R11 — Componentes**; **novo R12 — Proveniência** |
| **Schemas afetados** | `schema_version` do catálogo pode subir |
| **Dados afetados** | catálogo autoritativo |
| **Testes obrigatórios** | proveniência; composição; contexto da taxa; paridade Python × TS/Deno |
| **Vetores necessários** | novos casos escritos aqui, executados em 4I |
| **Gate de entrada** | 4G PASS |
| **Gate de saída** | `STATIC_PASS` **e** `comparar.py` byte a byte concordante |
| **Rollback** | revert do commit de catálogo; o `release_id` volta ao anterior |
| **PASS** | os oito totais compõem exatamente; nenhuma fonte fabricada |
| **FAIL** | qualquer total publicado como tarifa fechada, ou qualquer `source_id` sem lastro real |

### `G19` — proveniência sem fabricar documento

Hoje `fontes[]` conhece dois tipos: `CATALOGO_DOMINIO` e
`TABELA_TARIFARIA_OFICIAL`. Nenhum descreve uma decisão humana operacional.

O plano acrescenta um **terceiro tipo**, cuja `referencia` aponta para o que
realmente existe: o documento de decisão humana versionado neste repositório, com
data, decisor e commit. Nada é inventado — a referência é verificável por
`git`.

```
source_id    (a definir em 4H)
tipo         DECISAO_HUMANA_OPERACIONAL
referencia   docs/decisoes-humanas/2026-08-19-fechamento-p1-p6.md
aprovada     true
nota         decisao humana operacional consolidada; sem documento
             normativo externo fornecido
```

**Teste obrigatório de proveniência:** toda `referencia` de `fontes[]` deve
existir no repositório ou ser um artefato declarado; um `source_id` apontando
para caminho inexistente é `FAIL`. Isso torna a fabricação de fonte
**mecanicamente detectável**, e é a mitigação do risco `R5`.

### `G08` — componentes

```
COMPONENTE            item cobravel isolado, com vigencia e fonte proprias
QUANTIDADE            0 ou 1 para a urna ("quando aplicavel")
CONDICAO DE APLICACAO semi-intacto SUSPENDE o ossuario e cobra a permanencia
TOTAL                 composicao declarada, nunca tarifa fechada
```

O teste decisivo é o de **condição de aplicação**: no cenário semi-intacto com
destino ossuário, o total deve conter a permanência de R$ 1.427,86 e **não**
conter o componente de ossuário. Uma tarifa fundida reprova este teste por
construção — é o que prova que a representação é composicional de verdade.

### `P5` — a mesma taxa, contextos distintos

R$ 94,00 é **uma** entrada de componente, com **contextos de aplicação
declarados**:

```
componente   taxa interna R$ 94,00
contextos    ABERTURA_MOVIMENTACAO_EM_JAZIGO
             ETAPA_INICIAL_PROCESSO_CONCESSAO
excluido     ossuario -> jazigo   (Transporte A5: somente R$ 106,57)
```

O contexto de exclusão é tão obrigatório quanto os de inclusão. **Teste:** o
cenário ossuário → jazigo produz R$ 106,57 e nunca R$ 200,57.

---

## FASE 4I — Release único e reconformidade

**Objetivo.** Fechar o novo `release_id` e reconformar, com o conjunto anterior
preservado e recuperável.

| | |
|---|---|
| **Gaps resolvidos** | nenhum novo — fecha `G02`, `G05`–`G09`, `G14`, `G15`, `G18`–`G20` |
| **Arquivos esperados** | `conformidade/vetores/**` (novo conjunto versionado), `conformidade/README.md`, `docs/fase4/RELEASE-E-CONFORMIDADE.md` |
| **Mudanças permitidas** | calcular o novo `release_id`; versionar o novo conjunto de vetores; atualizar a asserção literal em `garantias_test.ts` |
| **Mudanças proibidas** | **editar ou apagar os vetores congelados da Fase 2**; ajustar vetor para fazer implementação passar |
| **Pré-condições** | 4H PASS |
| **Contratos afetados** | R1–R12 revalidados |
| **Schemas afetados** | nenhum |
| **Dados afetados** | nenhum novo |
| **Testes obrigatórios** | suíte completa; `comparar.py`; recuperabilidade do conjunto antigo |
| **Vetores necessários** | conjunto novo completo, incluindo os casos escritos em 4G e 4H |
| **Gate de entrada** | 4H PASS |
| **Gate de saída** | **todos os casos do novo conjunto em `PASS`**, zero `FAIL`, zero `INVALIDO` |
| **Rollback** | revert de 4H e 4G restaura o `release_id` anterior e revalida o conjunto congelado |
| **PASS** | conjunto novo 100% `PASS` **e** conjunto antigo ainda recuperável sem depender de branch viva |
| **FAIL** | qualquer `FAIL`, ou qualquer vetor congelado alterado |

### A regra que governa esta subfase

```
A implementacao se adapta ao vetor.
O vetor NUNCA e alterado para fazer a implementacao passar.
Se a referencia divergir do vetor: corrigir a referencia.
```

Regerar sob novo `release_id` **não** é ajustar vetor — é reconhecer que o
conhecimento mudou. A distinção é a mesma já registrada nas decisões anteriores.

### Um caso muda de mérito, não só de `release_id`

`V04-C` provava indisponibilidade por vigência usando `2026-01-06`. Com a
vigência decidida começando em `2026-01-01`, aquela data passa a estar **dentro**
da vigência. O caso equivalente no conjunto novo deve usar uma data **realmente
anterior** — por exemplo `2025-12-31`.

**O `V04-C` congelado não é alterado.** Ele continua correto para o release
`exu-1.0-32cc48f26797`.

### Recuperabilidade

O requisito é: o conjunto anterior continua recuperável **sem depender de branch
viva**. O mecanismo fica a critério de quem implementar — diretório versionado
por release, tag, ou artefato de CI. O **teste** não é opcional: um comando que
recupera o conjunto antigo e o executa contra o release antigo, obtendo `PASS`.

---

## FASE 4J — Testes integrados e gates de produção

**Objetivo.** Provar os cenários ponta a ponta e declarar os gates que liberam
persistência e integrações — sem executá-los.

| | |
|---|---|
| **Gaps resolvidos** | nenhum — prova todos |
| **Arquivos esperados** | `tests/integracao/**`, `docs/fase4/GATES-DE-PRODUCAO.md` |
| **Mudanças permitidas** | acrescentar testes integrados; declarar gates |
| **Mudanças proibidas** | conectar Supabase real; conectar n8n; conectar W-API; enviar mensagem a qualquer número |
| **Pré-condições** | 4I PASS |
| **Contratos afetados** | todos, em revalidação |
| **Schemas afetados** | nenhum |
| **Dados afetados** | nenhum |
| **Testes obrigatórios** | os dezoito cenários do §17 |
| **Vetores necessários** | nenhum novo |
| **Gate de entrada** | 4I PASS |
| **Gate de saída** | os dezoito cenários verdes, **offline** |
| **Rollback** | revert; nenhum efeito externo por construção |
| **PASS** | dezoito cenários verdes sem rede |
| **FAIL** | qualquer cenário vermelho, ou qualquer chamada de rede detectada |

---

# 5. Solicitação e case — resumo do desenho

Tratado em 4B. Os pontos que não podem ser perdidos:

- **estado não é enum global** — cada categoria declara o seu ciclo;
- **assunto é composto por regra** a partir de fatos confirmados, nunca redigido
  pelo LLM, e fail-closed quando faltam fatos;
- **dados coletados são referência, não cópia** — `isolation_rules` já proíbe
  copiar fatos entre cases;
- **overlay não é categoria** — reclamação continua sendo `overlay_of` no goal, e
  a categoria da solicitação é outro campo;
- **o teste de não-colapso** é o guardião: sete categorias, nenhum par com o
  mesmo estado observável.

---

# 6. Sessão × processo — resumo

Tratado em 4C. Vínculo **unidirecional** do processo para a sessão; a política
3+2 permanece onde já está (`conversation_sessions`, worker 180 s / 120 s); o
teste compara hash do estado do processo antes e depois de `CLOSED`.

---

# 7. Processo ativo × mensagem atual — o caso obrigatório

O mecanismo já existe: `PARALLEL_QUESTION` declara `park_pending_question`,
`push_goal(informational)`, `suspend_parent = false`, com o invariante de que o
goal-base permanece `ACTIVE`. O que falta é a **rota** — `G18`.

```
CENARIO OBRIGATORIO
  Recadastro em andamento, documentos ja recebidos
  Municipe: "Quanto custa uma lapide?"

ESPERADO
  responde a pergunta comercial
  Recadastro permanece ACTIVE
  documentos permanecem, nenhum e repedido
  nenhuma reinicializacao
  retomada do Recadastro apos a resposta

ONDE
  motor: 4D          rota informativa: 4G (goal)
  documentos: 4E     teste integrado: 4J
```

O ponto técnico é que uma pergunta de preço comercial hoje cairia em
`GOAL_COMERCIAL`, que **cria case** e não é informacional. A rota informativa
para consulta de preço é criada em 4G, dentro do lote.

---

# 8. Reclassificação — resumo

Tratado em 4D. Evento novo, aditivo, com invariante de preservação de fatos e
registro do tópico de origem. Os quatro eventos existentes **não** são
reaproveitados nem têm sua semântica alterada — há teste que o afirma.

---

# 9. Administração Provisória — resumo

Tratado em 4G. Instrumento com ciclo próprio; **nunca** dentro de
`recadastro_status`; invariante testável `AP != Concessão`. É a mitigação do
risco `R2`.

---

# 10. Origem — resumo

Tratado em 4G. Eixo próprio, três categorias, seis regras. Identificadores finais
exigem desenho explícito — **não** decididos por coincidência textual. Testes que
provam que a origem nunca é derivada do destino nem de número de quadra.

---

# 11. Proveniência — resumo

Tratado em 4H. Terceiro tipo de fonte, apontando para o documento de decisão
humana versionado. Teste que torna a fabricação de fonte mecanicamente
detectável.

---

# 12. Componentes de cobrança — resumo

Tratado em 4H. Componente, quantidade, condição de aplicação e total composto. O
teste do cenário semi-intacto é o que prova composicionalidade real.

---

# 13. Documentos — resumo

Tratado em 4E. Cinco estados mais `NAO_SOLICITADO`; `RECEBIDO → ACEITO` é
autoridade humana; invalidação seletiva espelhando
`recompute_affected_dependencies_only`.

---

# 14. Autoridade humana — resumo

Tratado em 4F. Sete ações em artefato próprio fora da fronteira; `executor`
declarado; confirmar agenda é `HUMAN` sem exceção;
`requested != confirmed` com três objetos distintos.

---

# 15. Fallback — resumo

Tratado em 4G. Três coisas distintas, e o teste que as separa:

| | Sujeito | Objeto | Consequência |
|---|---|---|---|
| incerteza do sistema | classificador | tópico | **não** roteia para `OUTROS_ASSUNTOS` |
| incerteza do munícipe | munícipe | um fato | `UNCERTAIN`, `confidence: UNCERTAIN` |
| demanda genuinamente sem tópico | — | a demanda | **dispara** o fallback |

---

# 16. Reclamações — resumo

**Nada a implementar.** Já está representado e protegido: `layer: OVERLAY`,
`replaces_base_goal: false`, `base_goal_remains_active: true`, `replace_base_goal`
em `forbidden`, `goal.overlay_of` no estado.

O que a Fase 4 acrescenta é a **categoria da solicitação** (4B) — que é outra
coisa. Teste de regressão obrigatório em 4J: *"comprei uma lápide e não
instalaram"* continua produzindo base `GOAL_COMERCIAL` com
`commercial_item = LAPIDE` **mais** overlay de reclamação, e a solicitação
registra assunto *"Lápide comprada e não instalada"*, nunca *"Reclamação"*.

---

# 17. Suíte de testes da Fase 4

| # | Teste | Subfase | Natureza |
|---|---|---|---|
| T01 | unitários de cada módulo novo | todas | unitário |
| T02 | contratos R7–R12 | 4B–4H | contrato |
| T03 | validação de `state.schema.json` | 4B–4F | schema |
| T04 | conformidade V1–V12, conjunto novo | 4I | conformidade |
| T05 | regressão: conjunto congelado ainda `PASS` no release antigo | 4I | conformidade |
| T06 | novos vetores (origem, componentes, proveniência, agendamento) | 4I | conformidade |
| T07 | transições de estado de solicitação, por categoria | 4B | state |
| T08 | reclassificação preserva fatos, documentos e vínculo | 4D | state |
| T09 | não-reuso: reclassificação não dispara `NEW_GOAL` | 4D | invariante |
| T10 | memória: fatos e documentos sobrevivem a mudança de assunto | 4E | state |
| T11 | retomada após nova sessão | 4C | integração |
| T12 | troca de assunto: o caso obrigatório do §7 | 4J | integração |
| T13 | documento já recebido não é repedido | 4E | state |
| T14 | mudança de destino recalcula só o afetado | 4J | integração |
| T15 | mudança de origem recalcula a modalidade | 4J | integração |
| T16 | `requested != confirmed`: agenda inalcançável sem humano | 4F | autoridade |
| T17 | 3+2 sem perda de processo (hash antes/depois) | 4C | garantia |
| T18 | composição de valores e os oito totais | 4H | dados |
| T19 | condição de aplicação: semi-intacto não cobra ossuário | 4H | dados |
| T20 | contexto da taxa: ossuário → jazigo = R$ 106,57 | 4H | dados |
| T21 | proveniência: toda `referencia` existe | 4H | dados |
| T22 | fronteira de autoridade: `ai_may_not` inviolado | 4F | autoridade |
| T23 | injeção de prompt / tentativa de forçar regra inexistente | 4J | segurança |
| T24 | não-colapso das sete categorias de solicitação | 4B | invariante |
| T25 | `AP != Concessão` | 4G | invariante |
| T26 | fallback não dispara por incerteza do classificador | 4G | invariante |
| T27 | guarda da fronteira do `release_id` | 4A | guarda |
| T28 | ausência de rede em todo o caminho testado | 4J | isolamento |

**T23 — injeção.** O vetor `V09` já cobre injeção contra o Gateway. A Fase 4
estende ao estado conversacional: uma mensagem que tente fazer o robô afirmar
preço inexistente, confirmar agenda, aceitar documento ou decidir sucessão deve
resultar em recusa fail-closed, **e o teste afirma que nenhum fato autoritativo
foi gravado** a partir dela.

---

# 18. Release e conformidade — o ponto exato

```
4A  4B  4C  4D  4E  4F        release_id INALTERADO
                              exu-1.0-32cc48f26797
                              47 vetores continuam PASS
    |
    | ------------------------ FRONTEIRA
    |
4G                            dominio muda -> release_id muda
                              47 vetores -> INVALIDO (esperado)
4H                            catalogo muda -> release_id muda de novo
                              (mesma janela, sem publicar entre 4G e 4H)
4I                            release_id NOVO e FECHADO
                              conjunto novo -> 100% PASS
                              conjunto antigo -> preservado e recuperavel
4J                            release_id estavel
```

| Evento | Quando |
|---|---|
| catálogo muda | 4H |
| contratos mudam | R7 (4B), R8 (4C), R9 (4D), R10 (4F), R11+R12 (4H) |
| vetores atualizados/adicionados | escritos em 4G e 4H, **executados** em 4I |
| referência Python atualizada | 4H |
| Gateway TS/Deno atualizado | 4H |
| conformidade completa executada | 4I |
| asserção literal do `release_id` em `garantias_test.ts` | 4I, e **só** em 4I |

**Nenhum bump intermediário.** Entre 4G e 4H o `release_id` muda de valor mas
**nada é publicado** — as duas subfases compõem uma janela única fechada em 4I.

---

# 19. Supabase, n8n e produção

**A Fase 4 inteira roda offline.** Nenhuma subfase de 4A a 4J conecta produção.

```
4A - 4J     OFFLINE. Sem Supabase, sem n8n, sem W-API, sem WhatsApp.
            Todo teste roda sem rede. T28 prova.
```

Gates para fases posteriores, em ordem, **nenhum deles pertence à Fase 4**:

| Gate | Libera | Pré-condição |
|---|---|---|
| `G-PERSIST` | persistência real em schema isolado | 4I PASS; migrações com manifesto verificado; RLS revisada |
| `G-SHADOW` | Supabase em modo shadow, sem efeito operacional | `G-PERSIST`; comparação shadow sem divergência |
| `G-N8N` | adaptador n8n carregando estado antes do classificador | `G-SHADOW`; identidade/conversation ID adaptada a UUIDs vNext |
| `G-WAPI` | W-API habilitada para envio | `G-N8N`; política de inatividade fora de shadow definida |
| `G-PROD` | WhatsApp em produção | todos acima; plano de rollback exercitado |

Os itens que ainda são `A_CONFIRMAR` em
`docs/dependencies-and-open-items.md` — templates institucionais, políticas de
handoff e filas humanas, endpoint Gemini, coexistência do estado legado —
continuam bloqueando `G-SHADOW` em diante. **Não** bloqueiam a Fase 4.

---

# 20. Riscos R1–R10 reavaliados

| ID | Descrição | Prob. | Impacto | Mitigação | Eliminado em | Teste que prova |
|---|---|---|---|---|---|---|
| **R1** | unificar prematuramente as seis formas de solicitação | **alta** | CRITICAL | estado é ciclo por categoria, nunca enum global (4B) | 4B | **T24** não-colapso |
| **R2** | implementar AP e perder a proteção por ausência | média | CRITICAL | invariante `AP != Concessão` desde o primeiro desenho | 4G | **T25** |
| **R3** | implementar reclassificação como `NEW_GOAL` | **alta** | HIGH | evento próprio, aditivo, com invariante de preservação | 4D | **T09** não-reuso |
| **R4** | implementar fallback usando `UNCERTAIN` | média | HIGH | condição declarada em `topics.v1.json`, três conceitos separados | 4G | **T26** |
| **R5** | fabricar fonte para preencher `source_id` | média | HIGH | tipo `DECISAO_HUMANA_OPERACIONAL` apontando para documento versionado | 4H | **T21** toda `referencia` existe |
| **R6** | tratar `INVALIDO` como regressão | média | MEDIUM | gate de saída de 4G **exige** `INVALIDO`; `FAIL` reprova | 4G | gate de 4G |
| **R7** | harmonizar os sete documentos consolidados | baixa | MEDIUM | proibido em toda subfase; a auditoria é o lugar do registro | — | revisão de diff |
| **R8** | enriquecer o Comercial sem decisão | baixa | LOW | `G14` marcado `FASE 4 REQUIRED = NO` | 4G | escopo de 4G |
| **R9** | colapsar `OSSUARIO`-origem com `OSSUARIO`-destino | **alta** | HIGH | eixos separados por regra; identificador exige desenho escrito | 4G | teste "origem nunca lida do destino" |
| **R10** | inferir `QUADRA_GERAL` de número de quadra | **alta** | HIGH | regra 2 de `P3`; localização física é eixo separado (`G15`) | 4G | teste de não-inferência |

## Riscos novos, introduzidos pelo próprio plano

| ID | Descrição | Prob. | Impacto | Mitigação | Teste |
|---|---|---|---|---|---|
| **R11** | o catálogo de ações fica com duas casas (4F) e alguém "conserta" movendo as quatro existentes, cruzando a fronteira sem querer | média | HIGH | decisão documentada em 4F; qualquer unificação só dentro de 4G | **T27** guarda da fronteira |
| **R12** | 4G e 4H formam uma janela em que o `release_id` está "no ar" e alguém publica no meio | baixa | CRITICAL | 4G e 4H não têm gate de publicação; só 4I fecha o release | gate de entrada de 4I |
| **R13** | 4B–4F acumulam seis subfases sem reconformidade, e um erro só aparece em 4I | média | MEDIUM | `STATIC_PASS` em cada subfase, com os 47 casos ainda em `PASS` — a conformidade **continua rodando**, só não muda | gate de saída de 4B–4F |

`R13` merece destaque: **agrupar o bump não significa suspender a conformidade.**
Durante 4A–4F os 47 casos continuam sendo executados a cada subfase e continuam
tendo de resultar `PASS`. É justamente por isso que o agrupamento é seguro.

---

# 21. Plano executável

| Ordem | Subfase | Gaps resolvidos | Artefatos | Dependências | Testes | Gate de saída | Risco eliminado | Altera `release_id`? | Rollback |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **4A** fundações | — | `garantias_test.ts`, `docs/fase4/` | `STATIC_PASS` em `main` | T27 | `STATIC_PASS` + `release_id` intacto | prepara R11 | **não** | revert |
| 2 | **4B** solicitação | `G01` `G12` `G02a` | `state.schema.json`, `engine/persistence*`, R7 | 4A | T02 T03 T07 T24 | `STATIC_PASS` + não-colapso | **R1** | **não** | revert (aditivo) |
| 3 | **4C** sessão × processo | `G11` | `state.schema.json`, R8, `blueprint-binding.md` | 4B | T11 T17 | hash idêntico antes/depois | — | **não** | revert |
| 4 | **4D** tópico e reclassificação | `G17` `G03` `G16` | `conversation-events.v1.json`, `state.schema.json`, R9 | 4C | T08 T09 | 10 eventos com semântica intacta | **R3** | **não** | revert (evento aditivo) |
| 5 | **4E** documentos | `G04` | `state.schema.json`, `engine/persistence*` | 4B | T10 T13 | ciclo documental completo | — | **não** | revert |
| 6 | **4F** autoridade e ações | `G10` `G13` `G07a` `G18a` | `actions.v1.json`, R10 | 4B 4E | T16 T22 | agenda inalcançável sem humano | — | **não** | revert |
| 7 | **4G** lote de domínio | `G20` `G06` `G07b` `G05` `G09` `G18b` `G02b` `G14` `G15` | os cinco catálogos, `perfis/` | 4A–4F | T25 T26 + P0 | 47 casos **`INVALIDO`**, zero `FAIL` | **R2 R4 R6 R9 R10** | **sim** | revert do lote |
| 8 | **4H** proveniência e componentes | `G19` `G08` | catálogo, `carregar.ts`, `consulta.ts`, referência Python, R11 R12 | 4G | T18 T19 T20 T21 | `comparar.py` concordante | **R5** | **sim** | revert do catálogo |
| 9 | **4I** release e conformidade | fecha os de 4G/4H | `conformidade/vetores/**` | 4H | T04 T05 T06 | conjunto novo **100% `PASS`** | **R12** | **fecha** | revert de 4H+4G |
| 10 | **4J** integrados e gates | prova todos | `tests/integracao/**`, gates | 4I | T12 T14 T15 T23 T28 | 18 cenários verdes, offline | **R13** | não | revert |

---

# 22. `PHASE_4_PLAN_GATE`

```
PHASE_4_PLAN_GATE = PASS
```

| Critério | Situação |
|---|---|
| todos G01–G20 possuem destino técnico | **sim** — cada gap tem subfase, artefato e teste; ver §1 e §21 |
| dependências ordenadas | **sim** — ordem em §2, com as quatro regras da auditoria preservadas e quatro mudanças justificadas |
| nenhum gap depende de nova decisão humana | **sim** — `DECISOES_HUMANAS_PENDENTES = 0` desde `b1d0c38` |
| nenhum risco `CRITICAL` sem mitigação planejada | **sim** — `R1` → T24, `R2` → T25, `R12` → gate de 4I |
| pontos de alteração de release/conformidade definidos | **sim** — §18; um único bump, fechado em 4I |
| estratégia de rollback | **sim** — toda subfase é revertível; 4G é commit único por desenho |
| testes definidos | **sim** — T01–T28, mapeados por subfase em §21 |

```
PASS NAO AUTORIZA IMPLEMENTACAO.
FASE 4 NAO FOI INICIADA NESTA TAREFA.
```

## Cobertura de G01 a G20

```
4B   G01 G12 G02a          4G   G20 G06 G07b G05 G09 G18b G02b G14 G15
4C   G11                   4H   G19 G08
4D   G17 G03 G16           4I   fecha os de 4G e 4H
4E   G04                   4J   prova todos
4F   G10 G13 G07a G18a
                            ---
                            20 / 20 com destino tecnico
```

---

# Fontes canônicas

| | |
|---|---|
| Auditoria e inventário de gaps | `docs/decisoes-humanas/2026-08-19-auditoria-cruzada-pre-fase-4.md` |
| Fechamento P1–P6 | `docs/decisoes-humanas/2026-08-19-fechamento-p1-p6.md` |
| Sete tópicos consolidados | `docs/decisoes-humanas/2026-08-19-*.md` |
| Fronteira do `release_id` | `santana-authority-gateway/catalogo/carregar.ts` |
| Pipeline `STATIC_PASS` | `.github/workflows/shadow-static.yml` |
| Estado conversacional | `santana-conversation-domain/state.schema.json` |
| Eventos | `santana-conversation-domain/conversation-events.v1.json` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Vetores e `INVALIDO` | `conformidade/vetores/FORMATO.md` |
| Itens `A_CONFIRMAR` | `docs/dependencies-and-open-items.md` |
| Estado operacional | `docs/HANDOFF-PROJETO-SANTANA.md` |
