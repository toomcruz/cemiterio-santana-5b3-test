# Auditoria cruzada final — inventário formal pré-Fase 4

```
DATA          2026-08-19
ESCOPO        auditoria cruzada dos sete topicos consolidados; inventario de
              contradicoes, gaps, decisoes humanas pendentes e gate pre-Fase 4
NATUREZA      AUDITORIA. Nao e decisao humana, nao e implementacao.
FASE 4        NAO INICIADA
```

Este documento **não decide nada**. Ele audita o que foi decidido, mede contra o
que está versionado, e produz o inventário de entrada da Fase 4. Onde encontra
divergência, **registra**; onde encontra ausência, **classifica como gap** e não
como contradição. Não altera runtime, catálogo, domínio, schemas, contratos,
enums, vetores, Gateway, referência Python, Supabase, n8n, workflows nem
`release_id`.

**Autoridade funcional desta auditoria:** os sete documentos de decisão humana em
`docs/decisoes-humanas/`. Onde a auditoria e uma decisão humana divergirem, a
decisão humana prevalece.

> **ATUALIZAÇÃO — fechamento de P1 a P6.**
> As seis decisões humanas pendentes identificadas em §21 foram **decididas** e
> registradas em `docs/decisoes-humanas/2026-08-19-fechamento-p1-p6.md`. Esta
> auditoria foi atualizada em §19 (`C-01`), §20 (`G19`, `G20`), §21 e §22. O
> corpo analítico das seções 1 a 18 **não foi reescrito**: ele descreve o estado
> auditado, e as seções de resultado registram o que mudou depois.
>
> ```
> DECISOES_HUMANAS_PENDENTES = 0
> PRE_PHASE_4_GATE           = PASS
> ```

---

# 1. Base documental validada

Branch `docs/handoff-projeto-santana`, árvore limpa. Os sete documentos estão
presentes e cada um é rastreável ao seu próprio commit — nenhum foi sobrescrito
por outro:

| # | Tópico | Documento | Commit |
| --- | --- | --- | --- |
| 1 | Exumação — tarifa e vigência | `2026-08-19-exumacao-tarifa-vigencia.md` | `cfac751` |
| 1 | Exumação — procedimento | `2026-08-19-exumacao-procedimento.md` | `93e14af` |
| 2 | Recadastro | `2026-08-19-recadastro-sucessao-administracao-provisoria.md` | `4fbb18e` |
| 3 | Transporte | `2026-08-19-transporte-falecidos-e-restos-mortais.md` | `7b676b9` |
| 4 | Processo de Concessão | `2026-08-19-processo-de-concessao.md` | `12d0121` |
| 5 e 6 | Comercial + Reclamações | `2026-08-19-comercial-basico-e-reclamacoes.md` | `1a07c0c` |
| 7 | Outros Assuntos | `2026-08-19-outros-assuntos.md` | `65cfdbf` |

Cadeia linear e íntegra: `cfac751 → 93e14af → 4fbb18e → 7b676b9 → 12d0121 →
1a07c0c → 65cfdbf`. Nenhum documento consolidado foi alterado nesta auditoria.

---

# 2. Auditoria cruzada dos sete tópicos

## 2.1 EXUMAÇÃO × TRANSPORTE

| Eixo a distinguir | Representação | Situação |
| --- | --- | --- |
| falecido ainda sepultado | `remains_status = SEPULTADO` | **existe** |
| necessidade de exumação | `exumacao_required` (derivado) via `REL_TRANSPORTE_REQUIRES_EXUMACAO` | **existe** |
| restos já exumados | `remains_status = EXUMADO` + `REL_TRANSPORTE_ALREADY_EXHUMED` | **existe** |
| localização atual dos restos | — | **não existe** (G06) |
| destino pretendido | `transport_destination` | **parcial** — não distingue ossuário alugado de perpétuo (G06) |
| mudança de destino | `CHANGE_OF_MIND` + `recompute_affected_dependencies_only` | **existe** |
| movimentação sem nova exumação | `REL_TRANSPORTE_ALREADY_EXHUMED` assere `exumacao_required = false`, escopo `CASE` | **existe** |

**A regra crítica está protegida.** "Está no jazigo" **não** implica "precisa ser
exumado": a inferência passa obrigatoriamente por `remains_status`, e
`REL_TRANSPORTE_ALREADY_EXHUMED` cobre o caso oposto de forma explícita, com
recálculo declarado se o fato for corrigido. O catálogo reforça pela entrada
`EXU_RESTOS_JA_EXUMADOS`.

**Ponto forte, não gap.** Esta é a distinção mais bem representada do modelo, e é
exatamente a que a decisão de Transporte (`A17`) considera crítica.

**O que falta** é a granularidade de destino e origem — tratada em G06.

## 2.2 RECADASTRO × CONCESSÃO

| Eixo | Representação | Situação |
| --- | --- | --- |
| pré-requisito de Recadastro | `REL_CONCESSAO_REQUIRES_RECADASTRO` (`kind: PREREQUISITE`) | **existe** |
| Recadastro confirmado | `recadastro_status = OK`, gravável só por sinal autoritativo | **existe** |
| Recadastro desconhecido | `recadastro_status = DESCONHECIDO` em `blocking_values` + `REL_CONCESSAO_RECADASTRO_UNKNOWN` + `ACTION_VERIFY_RECADASTRO` | **existe** |
| Administração Provisória — existência, titular, vigência, vencimento, 1ª/2ª, histórico, troca, desistência, falecimento, sucessor, regularização | apenas `OBTIDA_ADMINISTRADOR_PROVISORIO` / `RESPONSAVEL_JAZIGO` como **papel de quem assina** | **não existe como instrumento** (G05) |
| início posterior de Concessão | `push_goal` com `return_to_parent` | **existe** |

**Não são tratados como o mesmo instrumento** — e por um motivo estrutural, não
por acidente: Concessão é `topic_code` com `GOAL_CONCESSAO` e `case_subject:
CONCESSION`; Administração Provisória **não é nada** no modelo além de um valor
de assinatura. A confusão é impossível hoje porque um dos dois **não existe**.

Isso é proteção por ausência, e ela **desaparece no instante em que a
Administração Provisória for implementada**. G05 é, por isso, o gap de maior
risco de reintrodução de erro.

## 2.3 COMERCIAL × RECLAMAÇÕES

| A distinguir | Representação | Situação |
| --- | --- | --- |
| **assunto** (ex.: lápide) | `commercial_item = LAPIDE`, no goal-base | **existe** |
| **natureza** (reclamação/acompanhamento) | `GOAL_RECLAMACAO` com `overlay: true`; no estado, `goal.overlay_of` aponta o goal-base | **existe** |

Prova versionada de que a classificação de reclamação **não apaga** o assunto:

```
REL_RECLAMACAO_OVERLAY
  replaces_base_goal      false
  base_goal_remains_active true
evento COMPLAINT
  forbidden: replace_base_goal
state.schema.json / goal
  overlay_of: string|null     <- o overlay aponta o base, nao o substitui
```

E a fixture `M08` — *"paguei a lápide faz meses e até hoje não colocaram"* — já
espera `primary_event: COMPLAINT` **com** `goal: GOAL_COMERCIAL`,
`commercial_item = LAPIDE`, `commercial_stage = PEDIDO_PAGO`,
`commercial_delivery_status = PENDENTE`.

**"Quero comprar uma lápide" × "comprei uma lápide e não instalaram"** são
distinguíveis hoje pelo par `commercial_stage` / `commercial_delivery_status`.

**Ponto forte.** O que falta é o **estado do acompanhamento** que nasce daí (G13)
e o rótulo legível da solicitação (G12).

## 2.4 RECLAMAÇÕES × OUTROS ASSUNTOS

| Eixo | Representação | Situação |
| --- | --- | --- |
| Reclamação como overlay | `layer: OVERLAY`, `requires_base_goal: true`, `creates_base_goal_when_absent: true` | **existe** |
| Outros Assuntos como base/fallback | `layer: BASE`, `fallback: true` | **existe** (a flag; não a condição — G09) |
| preservação do assunto original | `overlay_of`, `replaces_base_goal: false` | **existe** |
| Outros Assuntos engolir uma reclamação | impossível: `RECLAMACOES` exige goal-base e **cria** um quando ausente; nunca substitui | **impedido estruturalmente** |
| Reclamação apagar o tópico-base | impossível: `replace_base_goal` está em `forbidden` | **impedido estruturalmente** |

**As duas impossibilidades pedidas já são impossibilidades técnicas**, não apenas
regras de conduta. É o par mais bem protegido do modelo.

---

# 3. Processo ativo × intenção atual

| Eixo | Representação | Situação |
| --- | --- | --- |
| A) processo/case ativo | `cases[]` + `goals[].case_id` + `status`/`stack_index` | **existe** |
| B) tópico principal | derivado de `goal_code → topic_code` | **parcial** — não há campo de tópico no estado (G17) |
| C) intenção da mensagem atual | `event_record.event_kind` (enum fechado de 10) | **existe** |
| D) assunto secundário | segundo goal na pilha, `informational: true`, `suspend_parent=false` | **existe** |
| E) overlay/natureza | `goal.overlay_of` | **existe** |

## O exemplo obrigatório

```
Recadastro em andamento + documentos ja recebidos
+ "Quanto custa uma lapide?"
```

**O modelo representa este caso.** O evento `PARALLEL_QUESTION` declara
exatamente esta operação:

```
effects     park_pending_question
            push_goal(informational)
            suspend_parent = false
invariants  pending_question nao e destruida nem substituida
            goal-base permanece ACTIVE apos a resposta informativa
```

E `parked_questions[]` existe no estado para segurar a pergunta estacionada.

| Exigência | Atendida? | Por quê |
| --- | --- | --- |
| responder à pergunta comercial | **sim** | `push_goal(informational)` |
| não destruir o Recadastro | **sim** | `suspend_parent = false`, goal-base permanece `ACTIVE` |
| não apagar documentos | **parcialmente** | os **fatos** sobrevivem (`status: ACTIVE`, `case_id` próprio, `case_scoped_facts_never_copied`). Mas **documento não é objeto** — ver G04 |
| não reiniciar o processo | **sim** | nenhum efeito de `PARALLEL_QUESTION` toca o goal-base |
| permitir retorno posterior | **sim** | `parked_questions` + `stack_index` |

**Uma ressalva material:** "quanto custa uma lápide" é uma pergunta **comercial
com preço**, e os goals informativos declarados hoje são apenas
`GOAL_INFO_OSSUARIO` e `GOAL_INFO_HORARIO`. Uma pergunta de preço comercial cairia
em `GOAL_COMERCIAL`, que **não é** `informational` e **cria case**. O mecanismo
existe; **o roteamento deste exemplo específico para ele não está declarado**.
Registrado em G18.

---

# 4. Reclassificação sem perda de contexto

Auditados os quatro eventos, contra a operação "começar em Outros Assuntos e
migrar para um tópico especializado preservando fatos, documentos e vínculo".

| Evento | O que declara | Por que **não** serve |
| --- | --- | --- |
| `NEW_GOAL` | `create_case_when_subject_differs`, `push_goal`; invariante **"nunca reutiliza facts de outro case"** | a demanda **não** é nova; e o invariante apagaria o contexto que a decisão manda preservar |
| `CORRECTION` | corrige o **valor de um fato** | a classificação do tópico não é um fato do modelo |
| `CHANGE_OF_MIND` | `supersede_fact(reason=CHANGE_OF_MIND)` | o munícipe **não mudou de ideia**: o entendimento da demanda melhorou |
| `UNCERTAIN` | *"usuario declara desconhecimento ou duvida sobre um fato"*, invariante `nao presumir valor` | é incerteza **do munícipe sobre um fato**, não do sistema sobre o tópico |

**Nenhum representa a operação.** E o `event_kind` é **enum fechado** em
`state.schema.json` — os dez valores são exaustivos, então não há como expressar
a reclassificação sem alterar o schema.

**Nenhum foi adaptado semanticamente para "caber".** → **G03**, `CRITICAL`.

Nota favorável: `isolation_rules` (`no_automatic_merge_between_cases`,
`case_scoped_facts_never_copied`) **não bloqueia** a reclassificação dentro do
**mesmo** case — protege a fronteira entre cases distintos. O gap é a ausência da
operação, não uma proibição dela.

---

# 5. Memória e continuidade

| Eixo | Onde vive hoje | Situação |
| --- | --- | --- |
| `SESSION` | **não existe** em `state.schema.json`. Existe na camada de persistência: `conversation_sessions.status` = `ACTIVE → WARNING_PENDING → WARNING_SENT → CLOSED` (`docs/blueprint-binding.md`) | **existe em outra camada** (G11) |
| `CASE/PROCESS` | `cases[]`, `subject_kind`, `subject_ref`, `opened_at_seq` | **existe** |
| `FACTS` | `facts[]` com `case_id`, `status ACTIVE/SUPERSEDED`, `authoritative`, `confidence` | **existe** |
| `DOCUMENTS` | apenas como `source: DOCUMENT` de um fato | **não existe como objeto** (G04) |
| `CURRENT_MESSAGE_INTENT` | `event_kind` | **existe** |
| `TOPIC` | derivado, não armazenado | **parcial** (G17) |
| `REQUEST` | — | **não existe** (G01) |

## O princípio obrigatório

```
SESSAO ENCERRADA  !=  PROCESSO ADMINISTRATIVO APAGADO
```

**O modelo não viola o princípio — ele simplesmente não o expressa.** A separação
existe *de facto*, porque `conversation_sessions` (Supabase) e `cases`/`facts`
(domínio conversacional) são artefatos diferentes, em camadas diferentes. Mas
**não há nenhum artefato versionado que declare o vínculo entre os dois**, nem
que afirme que fechar a sessão preserva o case.

Isso é pior do que uma violação declarada: é uma garantia que **ninguém escreveu
e que nada testa**. → **G11**, `HIGH`.

Sobre mudança de assunto, o modelo **é forte**: `PARALLEL_QUESTION` preserva
`pending_question`; `CHANGE_OF_MIND` recalcula **apenas** dependências afetadas
com o invariante *"fatos nao dependentes do fato alterado permanecem ACTIVE"*; e
fatos superseded ficam com `superseded_by`/`supersession_reason`, isto é,
**nada é apagado — é versionado**.

---

# 6. Documentos

**Documentos não existem como objeto no modelo.** Existem apenas como um valor de
`fact.source` (`DOCUMENT`) e como fonte aceita de sinal autoritativo.

| Estado conceitual pedido | Representação hoje |
| --- | --- |
| não solicitado | — |
| solicitado | aproximável por `pending_action` com `executor: HUMAN` |
| recebido | inferível de um fato com `source: DOCUMENT` |
| aceito | confundido com "recebido" — `authoritative: true` só distingue origem, não aceitação |
| ilegível/inadequado | **não existe** |
| pendente | aproximável por `pending_question` / `pending_action` |

Não há coleção `documents`, não há identidade de documento, não há transição de
estado documental, e **não há como expressar "recebi e recusei"** — hoje um
documento inadequado é indistinguível de um documento nunca enviado.

**Reutilização após mudança temporária de assunto:** funciona **para os fatos**
extraídos do documento — `PARALLEL_QUESTION` não os toca, `never_repeat_confirmed_active_fact`
impede repergunta, e `case_scoped_facts_never_copied` os mantém no case certo.
**Não funciona para o documento em si**, que não tem existência para ser
reutilizado ou reapresentado.

→ **G04**, `HIGH`. Exigido por Recadastro `B3` (controle documental), Concessão
`A7`/`A9` (três documentos, documentação incompleta), Transporte `A15`/`A18`
(certificado de cinzas, memorandos), Exumação item 12.

---

# 7. Administração Provisória — mapeamento existe / não existe / parcial

| Elemento | Situação | Evidência |
| --- | --- | --- |
| existência da Administração Provisória | **NÃO EXISTE** | nenhum fato, entidade ou case a representa |
| titular | **NÃO EXISTE** | — |
| vigência | **NÃO EXISTE** | — |
| vencimento | **NÃO EXISTE** | — |
| primeira Administração | **NÃO EXISTE** | — |
| segunda Administração | **NÃO EXISTE** | — |
| histórico | **NÃO EXISTE** | — |
| troca | **NÃO EXISTE** | — |
| desistência do Administrador atual | **NÃO EXISTE** | — |
| falecimento | **NÃO EXISTE** | — |
| sucessor que assumirá | **NÃO EXISTE** | — |
| necessidade de regularização posterior | **NÃO EXISTE** | — |
| **papel de quem assina** | **EXISTE PARCIALMENTE** | `required_authorization_signatory` inclui `OBTIDA_ADMINISTRADOR_PROVISORIO` e `RESPONSAVEL_JAZIGO`; `EXU_ASSINATURA_*` no catálogo; `destination_grave_authorization` cita "concessionário ou Administrador Provisório" |
| entidade `HOLDER` | **EXISTE PARCIALMENTE** | `subject_kind` aceita `HOLDER`, e o tópico `RECADASTRO` declara a entidade — mas nada a instancia como titular de Administração Provisória |

```
EXISTE            1 item  (papel de assinatura, parcial)
EXISTE PARCIAL    1 item  (entidade HOLDER, sem semantica de AP)
NAO EXISTE       12 itens
```

A decisão de Recadastro exige os doze: `A2` (instauração), `A6` (validade e
segunda Administração), `A7` (troca voluntária), `A8` (GOV.BR dos dois
administradores — o que pressupõe **dois titulares identificados**), `A9`
(falecimento e sucessor), `A3`/`A5` (ordem sucessória).

`A8` é o teste mais direto: exigir que **o atual** e **o novo** assinem pelo
GOV.BR é impossível de representar quando não existe "o atual" nem "o novo".

→ **G05**, `CRITICAL`. **Nenhum schema criado nesta tarefa.**

---

# 8. Restos mortais / Transporte — eixos separados?

| Eixo | Representação | Situação |
| --- | --- | --- |
| localização atual | — (`burial_reference` é `TEXT` livre) | **não existe** |
| sepultado/exumado | `remains_status` | **existe** |
| modalidade do ossuário — alugado/perpétuo | — | **não existe** |
| vencimento (contrato de 5 anos) | — | **não existe** |
| pendência (financeira/documental) | — | **não existe** |
| destino | `transport_destination` (4 valores) | **parcial** — `OSSUARIO` colapsa alugado e perpétuo |
| documentos | — | **não existe** (ver G04) |
| movimentação | goal + relações | **existe** |
| solicitação de agendamento | `transport_date_preference` = **preferência**, não solicitação | **não existe** |
| agendamento confirmado | — | **não existe** |

**Estão colapsados.** O custo é mensurável e está na própria decisão: Transporte
`A17.2` separa **R$ 480,65** de **R$ 3.049,70** exclusivamente pela modalidade do
ossuário — o eixo que hoje não existe. Os dois casos são, para o modelo atual, o
mesmo `transport_destination = OSSUARIO`.

→ **G06** (eixos de restos), `HIGH`; **G07** (agendamento), `HIGH`.

---

# 9. Solicitações

`state.schema.json` define `case` com **quatro campos**:

```
case_id        string
subject_kind   DECEASED | GRAVE | CONCESSION | ORDER | HOLDER | GENERIC
subject_ref    string
opened_at_seq  integer
```

| Precisa preservar | Representação |
| --- | --- |
| assunto real | **não existe** — ver abaixo |
| categoria | **não existe** |
| tópico relacionado | derivado do goal, não armazenado |
| natureza/overlay | `goal.overlay_of` — **existe**, mas no goal, não na solicitação |
| resumo da necessidade | **não existe** (`other_subject_description` é o relato, não o resumo) |
| dados coletados | `facts[]` — **existe** |
| pendências | `pending_question`, `pending_actions` — **existe** |
| encaminhamento | `pending_action.executor` — **parcial** |
| motivo da abertura | `goal.created_by_relation` — **parcial**, e só quando nasce de relação |
| estado da solicitação | **não existe** (`goal.status` é do goal, não da solicitação) |

## `subject_kind` / `subject_ref` **não** são `REQUEST_SUBJECT`

Este é o achado mais fácil de confundir e o mais importante desta seção.

```
subject_kind / subject_ref  ->  QUAL ENTIDADE   (o falecido X, o jazigo Y)
REQUEST_SUBJECT             ->  QUAL DEMANDA    ("Duvida sobre comunicado recebido")
```

Um caso de `subject_kind: GRAVE, subject_ref: <jazigo>` não diz **nada** sobre o
que a pessoa quer daquele jazigo. Os dois exemplos obrigatórios da decisão
provam a lacuna:

| Não pode registrar | Quando já sabemos |
| --- | --- |
| "Outros Assuntos" | "Dúvida sobre comunicado recebido" |
| "Reclamação" | "Lápide comprada e não instalada" |

O segundo é especialmente instrutivo: os **fatos** para compor o rótulo já
existem (`commercial_item = LAPIDE`, `PEDIDO_PAGO`, `PENDENTE`) — falta o **campo
onde o rótulo vive** e a regra de composição.

Não existe `REQUEST_SUBJECT`, `proposal_subject` nem equivalente. Registro que
`docs/dependencies-and-open-items.md` já lista, como `A_CONFIRMAR`, *"templates
institucionais e de assunto de solicitação publicados"* e *"schemas de dados
mínimos por serviço e por Reclamação"* — o item **é conhecido**, e continua
aberto.

→ **G01** (entidade solicitação), `CRITICAL`; **G12** (assunto legível),
`CRITICAL`. **Nenhum campo criado nesta tarefa.**

---

# 10. Criação de solicitação — as diferenças, sem abstração prematura

| Caso funcional | Exigência humana | Domínio hoje | Natureza da diferença |
| --- | --- | --- | --- |
| Outros Assuntos sem resposta segura | abrir solicitação para a **Administração** (`A3`) | `GOAL_OUTROS_ASSUNTOS` — **`creates_case: false`** | goal conversacional que precisa protocolar |
| Comercial — contato/orçamento | abrir solicitação para o **setor comercial** (`A2`, `A4`, `A5`) | `GOAL_COMERCIAL` — `creates_case: true`, `subject: ORDER` | case existe; **destinatário** e **motivo** não |
| Concessão — cobrança da taxa inicial | abrir solicitação de **cobrança** antes da documentação completa (`A4`, `A9`) | `GOAL_CONCESSAO` — `creates_case: true`, `subject: CONCESSION` | case existe; **cobrança** é outro objeto, e "taxa solicitada" ≠ "taxa paga" |
| Reclamações | solicitação normal **categorizada** como `RECLAMAÇÃO` (`A8`) | `GOAL_RECLAMACAO` — **`creates_case: false`**, `overlay: true` | o case vem do **base**; falta a **categoria** |
| Acompanhamento / pós-venda | solicitação de **acompanhamento**, não nova venda (`A3`, `A6`) | `commercial_delivery_status` detecta o caso; nada representa o acompanhamento | detecção existe, **objeto de acompanhamento** não |
| Agendamento | **solicitação** de agendamento, nunca confirmação (Exumação 17, Transporte `A20`) | `transport_date_preference` = preferência | preferência ≠ solicitação ≠ confirmação (três estados, um campo) |

**Seis casos, seis diferenças distintas.** Dois têm `creates_case: false` e
precisam protocolar; dois têm case mas lhe falta destinatário ou categoria; um
precisa de um objeto que não existe; um precisa de três estados onde há um campo.

**Não unifiquei.** Uma abstração única de "solicitação" resolveria o
protocolamento e **esconderia** que taxa-solicitada/taxa-paga, agendamento-pedido/
agendamento-confirmado e venda/acompanhamento são pares que a decisão humana
exige manter separados. → **G02**, `CRITICAL`.

---

# 11. Encaminhamento e fronteira de autoridade

## O que já existe — e é forte

```
facts.v1.json / ai_boundary
  ai_may       EXTRACT_CANDIDATE_FACT, IDENTIFY_EVENT, SUMMARIZE, DRAFT_ANSWER
  ai_may_not   DEFINE_OFFICIAL_RULE, DEFINE_REQUIRED_DOCUMENTS, DEFINE_PRICES,
               DEFINE_PERMISSIONS, DECIDE_SUCCESSION_RIGHTS, DECIDE_LEGAL_MATTERS,
               EXECUTE_PROTECTED_TRANSITION
```

| "ROBÔ NÃO PODE" (decisões humanas) | Coberto por |
| --- | --- |
| decidir sucessão | `DECIDE_SUCCESSION_RIGHTS` — **coberto** |
| inventar regularidade | `authoritative_signal_policy`: `USER_EXPLICIT`/`LLM_EXTRACTION`/`INFERENCE` são `rejected_as_confirmation` — **coberto** |
| inventar resposta sem conhecimento seguro | `A_CONFIRMAR` + Gateway responde `NOT_AVAILABLE` sem fonte — **coberto** |
| substituir Setor de Concessões | — **não coberto** (G10) |
| confirmar agenda sem confirmação humana | — **não coberto** (G07) |

E `pending_action.executor` = `SYSTEM | HUMAN | SYSTEM_OR_HUMAN` é uma primitiva
de fronteira **já existente e já usada**: `ACTION_COLLECT_GRAVE_AUTHORIZATION` e
`ACTION_COLLECT_EXHUMATION_AUTHORIZATION` são `HUMAN`;
`ACTION_VERIFY_RECADASTRO` e `ACTION_VERIFY_GRAVE_SITUATION` são
`SYSTEM_OR_HUMAN`. O objeto `handoff` cobre "aguardar validação humana" com
`confirmed_facts`, `pending_facts` e `essential_context`.

## O que falta

| Necessidade | Situação |
| --- | --- |
| encaminhar à Administração (genérico) | **não existe** — as quatro ações são de verificação/coleta específica |
| encaminhar/orientar Setor de Concessões | **não existe** — destinatário não modelado |
| solicitar contato Comercial | **não existe** |
| solicitar acompanhamento | **não existe** |
| aguardar validação humana | **existe** (`handoff`, `executor: HUMAN`) |
| aguardar confirmação de agenda | **não existe** |

→ **G10**, `HIGH`. Os `AUTHORITY_GAPS` são **de destinatário e de estado de
espera**, não de permissão: a fronteira do que o LLM pode decidir está
**declarada e fechada**.

---

# 12. Solicitação de agendamento × agendamento

```
transport_date_preference   "Data pretendida do transporte"   TEXT, USER_EXPLICIT
```

Um campo, alimentado pelo munícipe. Não há `REQUESTED`, não há `CONFIRMED`, não
há quem confirmou nem quando.

A decisão é explícita e repetida em dois tópicos — Exumação item 17
(*"preferência NÃO significa reserva nem confirmação"*, com grade
segunda a sexta, 08:30/09:00/09:30) e Transporte `A20`
(`SOLICITAÇÃO DE AGENDAMENTO != AGENDAMENTO CONFIRMADO`) — e aplica-se a
exumação, retirada/desativação de ossuário e movimentações.

São **três** estados distintos hoje colapsados em um campo de texto:

```
PREFERENCIA DO MUNICIPE  ->  SOLICITACAO ABERTA  ->  AGENDAMENTO CONFIRMADO
     (declarada)              (protocolada)          (por autoridade humana)
```

O risco é direto: sem o terceiro estado, nada impede o sistema de **ecoar a
preferência como se fosse confirmação** — que é precisamente o que as duas
decisões proíbem. → **G07**, `HIGH`.

---

# 13. Valores e componentes de cobrança

## Inventário completo dos valores decididos

| Valor | Componente | Origem documental | No catálogo? |
| --- | --- | --- | --- |
| R$ 106,57 | exumação de ossuário / desativação | catálogo + Transporte `A4` | **sim** |
| R$ 351,67 | exumação Quadra Geral | catálogo + Exumação 5 | **sim** |
| R$ 586,04 | exumação Jazigo de Família | catálogo + Exumação 10 | **sim** |
| R$ 386,65 | ossuário alugado | Exumação 5/10, Transporte `A17.2` | **não** |
| R$ 2.955,70 | aquisição de ossuário perpétuo | Exumação 5/10, Transporte `A17.2` | **não** |
| R$ 250,00 | urna para ossos | Exumação 5/10 | **não** |
| R$ 1.427,86 | permanência +3 anos (semi-intacto) | Exumação 6 | **não** |
| R$ 94,00 | abertura/movimentação em jazigo | Transporte `A13`/`A16`/`A17.2` | **não** |
| R$ 94,00 | taxa inicial do Processo de Concessão | Concessão `A4` | **não** |

**Cinco valores** e **dois componentes homônimos** não existem no catálogo.

## Aritmética conferida — nenhuma divergência de valor

| Total | Composição | Confere? |
| --- | --- | --- |
| R$ 738,32 | 351,67 + 386,65 | sim |
| R$ 3.307,37 | 351,67 + 2.955,70 | sim |
| R$ 601,67 | 351,67 + 250,00 | sim |
| R$ 836,04 | 586,04 + 250,00 | sim |
| R$ 972,69 | 586,04 + 386,65 | sim |
| R$ 3.541,74 | 586,04 + 2.955,70 | sim |
| R$ 480,65 | 94,00 + 386,65 | sim |
| R$ 3.049,70 | 94,00 + 2.955,70 | sim |

**Oito totais, oito composições exatas.** Nenhum valor diverge entre documentos.
**Nenhum valor foi alterado nesta auditoria.**

## O gap

O catálogo publica **tarifas monolíticas** sob `tipo_informacao: PRECO`, com
`modalidade_tarifaria`, `aplicabilidade` e `vigencia`. Não existe noção de:

- **componente** (item cobrável isolado);
- **quantidade** (a urna é "quando aplicável" — 0 ou 1);
- **condição de aplicação** (semi-intacto **suspende** a cobrança do ossuário e
  cobra a permanência — Exumação 6);
- **total calculado** como composição declarada.

A condição de aplicação é o teste decisivo: uma tarifa fundida de R$ 738,32
**não consegue deixar de cobrar metade de si mesma** quando o item 6 manda não
cobrar o ossuário naquele momento. → **G08**, `HIGH`.

**Consequência de release já registrada:** publicar qualquer componente altera o
conteúdo autoritativo e portanto o `release_id`. Os vetores do release
`exu-1.0-32cc48f26797` passam a `INVALIDO` — **esperado, não `FAIL`** — e os
vetores congelados da Fase 2 **não são reescritos**.

---

# 14. Fallback de Outros Assuntos

```
topics.v1.json
  OUTROS_ASSUNTOS   layer: BASE   fallback: true
```

**A flag existe. A condição de disparo não está versionada em lugar nenhum.**
Varredura do domínio, do motor e do runtime: as únicas outras ocorrências de
`fallback` são `fallback_disabled` / `fallback_timeout` / `fallback_error` /
`fallback_invalid` em `runtime/adapter/adapter.ts` — o adaptador de LLM caindo
para o mock, **sem relação** com roteamento de tópico.

A decisão humana define o disparo, e o define pela negativa mais importante:

```
NAO:  o classificador ficou incerto
SIM:  a demanda, apos entendimento suficiente, nao pertence com
      seguranca a nenhum topico especializado
```

E os dois tipos de incerteza **não podem ser confundidos**:

| | Sujeito | Objeto | Representação |
| --- | --- | --- | --- |
| incerteza do sistema | classificador | o **tópico** | **não existe** |
| incerteza do munícipe | munícipe | um **fato** | `UNCERTAIN`, `confidence: UNCERTAIN`, `blocking_values` |

Implementar o primeiro **com** o segundo colapsaria exatamente a distinção que a
decisão existe para criar. → **G09**, `HIGH`.

---

# 15. Primeira mensagem antes do menu

| O que a regra exige | Situação |
| --- | --- |
| interpretar a primeira mensagem antes de obrigar navegação por menu | **não há regra versionada** que o declare |
| usar a intenção quando identificável com segurança | compatível com `selection_rules.never_repeat_confirmed_active_fact` e com `ai_may: IDENTIFY_EVENT` |
| não ignorá-la em favor de menu genérico | nada a proíbe explicitamente |

A referência mais próxima é `docs/legacy-new-mapping.md`, Nó 27 — *"Classificar
menu e proteger duplicidade → classificador com estado pré-carregado"* —, que
trata de **classificação e duplicidade**, não de precedência da primeira
mensagem sobre o menu.

**Compatibilidade com a arquitetura futura: sim.** O modelo é orientado a fatos e
eventos, não a passos de menu; `questions.v1.json / selection_rules` já proíbe
repergunta de fato confirmado e manda perguntar primeiro o fato que muda a
próxima decisão. A arquitetura **favorece** a regra — só não a declara.

→ **G16**, `MEDIUM`, `CONVERSATIONAL_GAP`.

---

# 16. Inatividade 3 + 2

**A política existe versionada — em outra camada.**

| Elemento | Onde | Situação |
| --- | --- | --- |
| 3 min → aviso; +2 min → encerramento | `docs/legacy-new-mapping.md`, Nó 59: *"worker 180 s / 120 s, sem W-API nesta fase"* | **existe** |
| máquina de estados da sessão | `docs/blueprint-binding.md`: `ACTIVE → WARNING_PENDING → WARNING_SENT → CLOSED` em `conversation_sessions.status` | **existe** |
| encerramento silencioso | `docs/security-review.md`: *"O aviso é apenas sinal `WARNING_WOULD_SEND`; o fechamento é silencioso"* | **existe** |
| separação sessão × processo | — | **não declarada** (G11) |
| preservação de case/facts/documents após encerramento | — | **não declarada nem testada** (G11) |
| retomada posterior | `parked_questions`, `stack_index`, fatos `ACTIVE` permitem — mas nada liga a sessão nova ao case antigo | **não declarada** (G11) |

Os dois primeiros itens estão **atendidos**. Os três últimos são o **mesmo gap**:
`conversation_sessions` vive no Supabase e `cases`/`facts` vivem no domínio
conversacional, e **nenhum artefato versionado declara o vínculo**. Sem ele,
"sessão encerrada ≠ processo apagado" é uma intenção, não uma garantia.

**Nenhum timer implementado nesta tarefa.**

---

# 17. Classificação

| Eixo | Representação | Situação |
| --- | --- | --- |
| `TOPIC / BASE` | derivado de `goal_code` | **parcial** — não armazenado |
| `OVERLAY / NATUREZA` | `goal.overlay_of` | **existe** |
| `CURRENT_MESSAGE_INTENT` | `event_record.event_kind` | **existe** |
| `ACTIVE_PROCESS` | `cases[]` + pilha de goals com `stack_index`/`status` | **existe** |
| `SECONDARY_TOPIC` | segundo goal na pilha | **existe** |

**Não há um campo único de "intenção" controlando o estado** — e isso é um
acerto estrutural do modelo, não uma pendência. Intenção da mensagem
(`event_kind`), processo ativo (`cases`/`goals`) e natureza (`overlay_of`) são
três objetos distintos, e a pilha de goals sustenta assunto principal e
secundário simultaneamente.

O que falta é menor e específico: **o tópico não é armazenado**, só derivado. Isso
torna impossível expressar "esta conversa começou em `OUTROS_ASSUNTOS` e migrou
para `RECADASTRO`", que é justamente o vínculo que G03 exige.

→ **G17**, `MEDIUM`.

---

# 18. Catálogo de ações — inventário e ausências

## Existem — quatro

| `action_code` | `executor` | Resolve |
| --- | --- | --- |
| `ACTION_VERIFY_GRAVE_SITUATION` | `SYSTEM_OR_HUMAN` | `destination_grave_situation` |
| `ACTION_COLLECT_GRAVE_AUTHORIZATION` | `HUMAN` | `destination_grave_authorization` |
| `ACTION_COLLECT_EXHUMATION_AUTHORIZATION` | `HUMAN` | `exhumation_authorization` |
| `ACTION_VERIFY_RECADASTRO` | `SYSTEM_OR_HUMAN` | `recadastro_status` |

Todas seguem o mesmo padrão: **resolver um fato autoritativo específico**. Nenhuma
delas encaminha, protocola ou aguarda.

## Ausentes — auditadas, não criadas

| Necessidade funcional | Exigida por | Situação |
| --- | --- | --- |
| abrir solicitação | Outros `A3`, Concessão `A4`, Comercial `A2`/`A4`/`A5`, Reclamações `A8` | **ausente** |
| encaminhar à Administração | Outros `A3`, `B2` | **ausente** |
| solicitar contato Comercial | Comercial `A2` | **ausente** |
| acompanhar processo | Concessão `A12`, Comercial `A3`/`A6` | **ausente** |
| solicitar agendamento | Exumação 17, Transporte `A20` | **ausente** |
| aguardar confirmação humana de agenda | Exumação 17, Transporte `A20` | **ausente** (o `handoff` genérico existe, mas não é confirmação de agenda) |
| reclassificar preservando contexto | Outros `A5`/`A6` | **ausente** — e não é ação: é evento (G03) |
| rotear pergunta de preço comercial como paralela | §3 desta auditoria | **ausente** (G18) |

**Sete ações ausentes e uma ausência de evento.** Nenhuma foi criada.

---

# 19. Contradições

**Regra aplicada:** ausência de representação é **gap**, não contradição.
Contradição exige dois enunciados versionados que não podem ser ambos
verdadeiros.

| ID | Tópicos | Arquivo A | Arquivo B | Contradição | Severidade | Decisão humana existente? | Ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **C-01** | Exumação × Transporte | `2026-08-19-exumacao-procedimento.md`, item 7, linha 142: *"Sem renovação, **caracteriza abandono** e os despojos vão para **ossuário geral**"* | `2026-08-19-transporte-falecidos-e-restos-mortais.md`, `A2`: *"poderá ser desativado"*; **não afirmar** automaticidade nem prazo exato de 1 mês | A não renovação produz consequência automática (A) ou apenas possibilidade sujeita a verificação (B) | **MEDIUM** | **SIM, integral** (era parcial) | **RESOLVIDA / SUPERADA por `P1`** — ver abaixo |

```
CONTRADICOES FUNCIONAIS   = 1
CONTRADICOES EM ABERTO    = 0
CRITICAL = 0   HIGH = 0   MEDIUM = 1 (resolvida)   LOW = 0
```

## `C-01` — resolvida por `P1`

**O achado não é apagado.** Ele fica registrado acima como encontrado, e aqui
como resolvido.

`P1` respondeu diretamente as duas metades do resíduo:

| Pergunta que estava aberta | Resposta de `P1` |
| --- | --- |
| "abandono" segue caracterizado pela simples falta de renovação? | **não** — *"A falta de renovação NÃO caracteriza automaticamente abandono"* |
| o que passa a acionar a desativação? | **a verificação da Administração** — *"a Administração verifica a situação atual"*; a desativação também não é afirmada automaticamente |

`P1` acrescenta ainda a faixa de **1 ano**, que não existia em nenhuma decisão
anterior: até 1 ano de vencimento não se alerta automaticamente; acima de 1 ano
informa-se que a situação precisa ser verificada — e ainda assim **sem** afirmar
abandono ou desativação.

O trecho do item 7 fica **explicitamente superado** quanto à automaticidade, e
**permanece versionado** como histórico. A `PENDENCIA_DE_RECONCILIACAO_DOCUMENTAL`
registrada na decisão de Transporte está **encerrada**.

Registro que `P1` **não** afirma que abandono e ossuário geral deixaram de
existir como desfecho possível: ela remove a automaticidade e o anúncio
automático, e encaminha à verificação. Nada além disso foi inferido.

## Pontos de atenção que **não** são contradições

Auditados e confirmados como compatíveis; registrados para que a Fase 4 não os
"resolva" por engano:

| ID | O que parece | Por que não é |
| --- | --- | --- |
| **A-01** | Exumação item 17 exige conjunto completo para abrir solicitação; Concessão `A4`/`A9` mandam cobrar antes da documentação | atos diferentes: **agendamento** de serviço físico × **cobrança** de taxa inicial |
| **A-02** | R$ 94,00 nomeia dois componentes (Transporte × Concessão) | tópicos, fatos geradores e incidências diferentes; **colisão de valor, não identidade** |
| **A-03** | Exumação item 10 cobra R$ 836,04 em "outro jazigo"; Transporte `A17.2` cobra R$ 94,00 | situações de origem diferentes: **restos ainda não exumados** × **já exumados** |
| **A-04** | `NEW_GOAL` proíbe reutilizar facts; Outros `A6` manda preservá-los | o invariante protege a fronteira entre **cases distintos**, não a reclassificação da mesma demanda |
| **A-05** | `GOAL_RECLAMACAO` tem `creates_case: false`, mas `A8` pede solicitação | o case vem do **goal-base**; falta a **categoria**, não o case |
| **A-06** | `fallback: true` sem condição × `A1` de Outros Assuntos | ausência de definição prévia, não conflito |

## Inconsistências detectadas entre documentos consolidados

Conforme §23, registradas aqui e **não harmonizadas nos originais**:

**I-01 — O4 da decisão de Exumação foi substancialmente fechado pela decisão de
Transporte.** `O4` registrava que a origem `RETIRADA_OU_DESATIVACAO_DE_OSSUARIO`
não tinha "fluxo, destinos, documentos nem regra de semi-intacto". A decisão de
Transporte, posterior, fornece destinos (`A5`–`A9`), valores e documentação para
exatamente essa origem. **Semi-intacto não se aplica** a restos já em ossuário.
`O4` permanece escrito como lacuna aberta, e **materialmente já não é**.
Severidade `LOW` — nenhum comportamento depende disso. **Não alterei o
documento.**

**I-02 — `docs/HANDOFF-PROJETO-SANTANA.md` lista `TRANSPORTE` entre os seis tipos
"sem fonte oficial", sem registrar que a decisão de Transporte já forneceu o
conteúdo.** É defasagem de índice, não contradição. Severidade `LOW`.

---

# 20. Inventário de gaps — deduplicado

Dezoito gaps, deduplicados entre os sete documentos. Gaps que apareciam em
múltiplos documentos foram fundidos **quando são o mesmo objeto**; gaps
parecidos com soluções potencialmente distintas foram **mantidos separados**,
conforme §20.

---

### `G01` — Solicitação/`REQUEST` não existe como objeto

| | |
| --- | --- |
| **Domínio** | estado conversacional / persistência |
| **Descrição** | não há entidade que represente a solicitação protocolada, com categoria, motivo, encaminhamento e estado próprio |
| **Evidência** | `state.schema.json`: `case` tem apenas `case_id`, `subject_kind`, `subject_ref`, `opened_at_seq` |
| **Decisão que o exige** | Concessão `A1`/`A4`; Comercial `A2`–`A6`; Reclamações `A8`; Outros `A3`; Exumação 17; Transporte `A20` |
| **Representação atual** | `case` (entidade), `goal.status` (do goal, não da solicitação) |
| **Impacto** | seis dos sete tópicos dependem de abrir solicitação |
| **Dependências** | — (é a base) |
| **Risco** | `CRITICAL` |
| **FASE 4 REQUIRED** | **YES** |

*Deduplica:* Concessão `C1`, Comercial `C1`/`C2`, Outros `C2`.

---

### `G02` — Goals que devem protocolar têm `creates_case: false`, e os que criam case não têm destinatário

| | |
| --- | --- |
| **Domínio** | goals |
| **Descrição** | seis casos funcionais de abertura de solicitação, com **seis diferenças distintas** — ver §10 |
| **Evidência** | `GOAL_OUTROS_ASSUNTOS` e `GOAL_RECLAMACAO`: `creates_case: false`; `GOAL_COMERCIAL`/`GOAL_CONCESSAO`: case sem categoria nem destinatário |
| **Decisão que o exige** | Outros `A3`; Reclamações `A8`; Comercial `A2`; Concessão `A4` |
| **Representação atual** | `creates_case` booleano |
| **Impacto** | sem isto, dois tópicos inteiros não conseguem protocolar |
| **Dependências** | `G01` |
| **Risco** | `CRITICAL` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | **não unificar** os seis casos numa abstração única — ver §10 |

---

### `G03` — Reclassificação preservando contexto não é representável

| | |
| --- | --- |
| **Domínio** | eventos conversacionais |
| **Descrição** | migrar a mesma demanda de um tópico para outro, preservando fatos, documentos e vínculo |
| **Evidência** | `event_kind` é **enum fechado** de 10 valores em `state.schema.json`; os quatro candidatos falham por motivos distintos (§4) |
| **Decisão que o exige** | Outros `A5`/`A6` |
| **Representação atual** | nenhuma |
| **Impacto** | sem isto, `A6` só é implementável violando `A6` (via `NEW_GOAL`) |
| **Dependências** | `G17` (tópico armazenado, para o vínculo) |
| **Risco** | `CRITICAL` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G04` — Documentos não têm existência nem estado

| | |
| --- | --- |
| **Domínio** | fatos / persistência |
| **Descrição** | seis estados documentais pedidos; nenhum representável. "Recebido e recusado" é indistinguível de "nunca enviado" |
| **Evidência** | documento existe apenas como `fact.source = DOCUMENT`; não há coleção `documents` |
| **Decisão que o exige** | Recadastro `B3`; Concessão `A7`/`A9`; Transporte `A15`/`A18`; Exumação 12 |
| **Representação atual** | `source: DOCUMENT`, `authoritative: true` |
| **Impacto** | controle documental, reaproveitamento e "documentação incompleta não bloqueia cobrança" |
| **Dependências** | `G01` |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G05` — Administração Provisória não existe como instrumento

| | |
| --- | --- |
| **Domínio** | domínio de Recadastro/Concessão |
| **Descrição** | doze elementos ausentes (§7); existe só o **papel de quem assina** |
| **Evidência** | `required_authorization_signatory` = `OBTIDA_ADMINISTRADOR_PROVISORIO`; nenhum fato de titular, vigência, ordem ou histórico |
| **Decisão que o exige** | Recadastro `A2`, `A3`, `A5`, `A6`, `A7`, `A8`, `A9` |
| **Representação atual** | parcial — papel de assinatura; entidade `HOLDER` sem semântica |
| **Impacto** | `A8` (GOV.BR do atual **e** do novo) é hoje inexprimível |
| **Dependências** | `G01` (regularização gera solicitação) |
| **Risco** | `CRITICAL` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | hoje a confusão AP × Concessão é impossível **porque a AP não existe**. Implementá-la **remove essa proteção** — a separação precisa ser explícita desde o primeiro desenho |

---

### `G06` — Eixos de restos mortais colapsados

| | |
| --- | --- |
| **Domínio** | domínio de Transporte/Exumação |
| **Descrição** | localização atual, modalidade do ossuário, vencimento e pendência não existem; destino colapsa alugado e perpétuo |
| **Evidência** | `transport_destination` tem 4 valores; `OSSUARIO` é um só |
| **Decisão que o exige** | Transporte `A8`–`A12`, `A17.2`; Exumação `O5` |
| **Representação atual** | `remains_status` (**existe**), `transport_destination` (parcial) |
| **Impacto** | separa R$ 480,65 de R$ 3.049,70 — o mesmo valor de destino hoje |
| **Dependências** | `G08` (os eixos determinam componentes) |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | **não** transformar em seis valores de um campo só — são **eixos diferentes** (Exumação `O5`) |

---

### `G07` — Agendamento: preferência, solicitação e confirmação num campo só

| | |
| --- | --- |
| **Domínio** | domínio de Transporte/Exumação + fronteira de autoridade |
| **Descrição** | três estados, um campo de texto declarado pelo munícipe |
| **Evidência** | `transport_date_preference`: `TEXT`, `USER_EXPLICIT` |
| **Decisão que o exige** | Exumação 17; Transporte `A20` |
| **Representação atual** | preferência apenas |
| **Impacto** | nada impede ecoar preferência como confirmação — proibido por duas decisões |
| **Dependências** | `G01`, `G10` |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G08` — Componentes de cobrança não são representáveis

| | |
| --- | --- |
| **Domínio** | catálogo autoritativo |
| **Descrição** | não há componente, quantidade, condição de aplicação nem total composto; cinco valores e dois componentes homônimos ausentes |
| **Evidência** | catálogo publica 3 tarifas monolíticas; 8 totais decididos são composições (§13) |
| **Decisão que o exige** | Exumação 5/6/10 e `O3`; Transporte `A17.2` e `C3`; Concessão `A4` |
| **Representação atual** | `modalidade_tarifaria` + `PRECO` monolítico |
| **Impacto** | semi-intacto exige **não cobrar metade** de uma tarifa fundida — impossível hoje |
| **Dependências** | `G06` |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | altera `release_id`; vetores antigos → `INVALIDO` (**esperado**, não `FAIL`); congelados **não** reescritos |

---

### `G09` — `fallback: true` sem condição de disparo

| | |
| --- | --- |
| **Domínio** | tópicos / classificação |
| **Descrição** | a flag existe; quando ela dispara não está versionado |
| **Evidência** | varredura: as demais ocorrências de `fallback` são do adaptador de LLM |
| **Decisão que o exige** | Outros `A1` |
| **Representação atual** | flag booleana sem semântica |
| **Impacto** | risco de implementar como "classificador incerto", que a decisão proíbe |
| **Dependências** | `G17` |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | **não** usar `UNCERTAIN`: é incerteza do munícipe sobre um fato, não do sistema sobre o tópico |

---

### `G10` — Destinatários de encaminhamento não existem

| | |
| --- | --- |
| **Domínio** | catálogo de ações |
| **Descrição** | sete ações ausentes (§18); as quatro existentes só resolvem fatos autoritativos específicos |
| **Evidência** | `authoritative_signal_policy.actions` tem exatamente 4 entradas |
| **Decisão que o exige** | Concessão `A1`/`A8`/`A10`/`A12`; Comercial `A2`/`A5`; Outros `A3` |
| **Representação atual** | `pending_action.executor` (**primitiva existe**), `handoff` (**existe**) |
| **Impacto** | "orientar contato com o Setor de Concessões" não é expressável |
| **Dependências** | `G01` |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G11` — Sessão e processo não têm vínculo declarado

| | |
| --- | --- |
| **Domínio** | arquitetura — fronteira entre camadas |
| **Descrição** | sessão vive no Supabase, case/facts no domínio conversacional; nada versionado declara que fechar a sessão preserva o processo |
| **Evidência** | `state.schema.json` **não tem** objeto de sessão; `conversation_sessions.status` está em `blueprint-binding.md` |
| **Decisão que o exige** | princípio `SESSÃO ENCERRADA != PROCESSO APAGADO`; política 3+2 |
| **Representação atual** | ambos os lados existem; **o vínculo não** |
| **Impacto** | a garantia mais visível ao munícipe é a única que ninguém escreveu nem testa |
| **Dependências** | `G01` |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G12` — Assunto legível da solicitação (`REQUEST_SUBJECT`)

| | |
| --- | --- |
| **Domínio** | solicitação |
| **Descrição** | `subject_kind`/`subject_ref` identificam a **entidade**, não a **demanda**. Não há onde escrever "Dúvida sobre comunicado recebido" |
| **Evidência** | `subject_kind` ∈ {`DECEASED`,`GRAVE`,`CONCESSION`,`ORDER`,`HOLDER`,`GENERIC`} |
| **Decisão que o exige** | Outros `A4`; Reclamações `A11` |
| **Representação atual** | `other_subject_description` = **relato**, não rótulo |
| **Impacto** | a Administração recebe "Outros Assuntos"/"Reclamação" quando o sistema já sabe mais |
| **Dependências** | `G01` |
| **Risco** | `CRITICAL` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | mantido **separado** de `G01`: um é a entidade, o outro é a regra de composição do rótulo a partir de fatos já existentes |

---

### `G13` — Estado de pós-venda / acompanhamento

| | |
| --- | --- |
| **Domínio** | Comercial |
| **Descrição** | o caso é **detectável** (`PEDIDO_PAGO` + `PENDENTE`), mas o acompanhamento não tem objeto nem ciclo |
| **Evidência** | `commercial_delivery_status` distingue; nada representa o acompanhamento aberto |
| **Decisão que o exige** | Comercial `A3`/`A6`; Concessão `A12` |
| **Representação atual** | detecção sim, acompanhamento não |
| **Impacto** | "não vender novamente" fica sem estado que o sustente entre atendimentos |
| **Dependências** | `G01` |
| **Risco** | `MEDIUM` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | **não** é o mesmo que `G01`: acompanhamento é ciclo **após** entrega, não abertura |

---

### `G14` — `commercial_item` não cobre portão/tranca nem reforma/construção

| | |
| --- | --- |
| **Domínio** | Comercial |
| **Evidência** | enum com 5 valores |
| **Decisão que o exige** | Comercial `A4`/`A5` |
| **Impacto** | dois fluxos decididos sem item correspondente |
| **Risco** | `LOW` |
| **FASE 4 REQUIRED** | **NO** |
| **Ressalva** | Comercial `A1` declara o tópico **deliberadamente básico**; pode ser enriquecimento futuro, e portão/tranca pode ser **subtipo** de `ZELADORIA`, não valor novo |

---

### `G15` — Localização física (Bloco I) não existe

| | |
| --- | --- |
| **Domínio** | Transporte |
| **Evidência** | `burial_reference` é `TEXT` livre; não há bloco, quadra ou setor |
| **Decisão que o exige** | Transporte `A8` |
| **Risco** | `LOW` |
| **FASE 4 REQUIRED** | **NO** |

---

### `G16` — Precedência da primeira mensagem sobre o menu não é declarada

| | |
| --- | --- |
| **Domínio** | conversacional |
| **Evidência** | nenhuma regra versionada; Nó 27 trata de menu e duplicidade, não de precedência |
| **Representação atual** | arquitetura **compatível** (orientada a fatos, `never_repeat_confirmed_active_fact`) |
| **Risco** | `MEDIUM` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G17` — Tópico não é armazenado, só derivado

| | |
| --- | --- |
| **Domínio** | classificação |
| **Evidência** | não há campo de tópico em `state.schema.json` |
| **Impacto** | impossível expressar "começou em X, migrou para Y" — pré-requisito de `G03` |
| **Dependências** | — |
| **Risco** | `MEDIUM` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G18` — Pergunta de preço comercial não tem rota informativa declarada

| | |
| --- | --- |
| **Domínio** | goals informativos |
| **Descrição** | `PARALLEL_QUESTION` exige `push_goal(informational)`, mas os únicos goals informativos são `GOAL_INFO_OSSUARIO` e `GOAL_INFO_HORARIO`. "Quanto custa uma lápide?" cairia em `GOAL_COMERCIAL`, que **cria case** e **não** é informacional |
| **Evidência** | `informational_goals.goals` tem 2 entradas |
| **Decisão que o exige** | o exemplo obrigatório de §3 desta auditoria |
| **Impacto** | o mecanismo de preservação existe; **este** caso não roteia para ele |
| **Dependências** | `G01` |
| **Risco** | `MEDIUM` |
| **FASE 4 REQUIRED** | **YES** |

---

### `G19` — Gap de proveniência: decisão humana não é um tipo de fonte

| | |
| --- | --- |
| **Domínio** | catálogo autoritativo — modelo de proveniência |
| **Descrição** | os cinco valores de `P6` têm decisão humana e vigência, mas **nenhuma fonte documental formal**. O catálogo exige `source_id` em toda entrada, e `fontes[]` só conhece os tipos `CATALOGO_DOMINIO` e `TABELA_TARIFARIA_OFICIAL` |
| **Evidência** | `santana-authority/catalogo/exumacao.v1.json`: quatro fontes declaradas, nenhuma cobre R$ 386,65 · R$ 2.955,70 · R$ 250,00 · R$ 1.427,86 · R$ 94,00 |
| **Decisão que o exige** | `P6` — e `P6` proíbe expressamente inventar portaria, decreto, URL ou documento inexistente |
| **Representação atual** | nenhuma — não existe tipo de fonte para "decisão humana operacional consolidada" |
| **Impacto** | bloqueia a **publicação** dos cinco valores; não bloqueia o registro da decisão |
| **Dependências** | `G08` |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | resolver **estendendo o modelo de proveniência**, nunca fabricando um documento que não foi fornecido |

---

### `G20` — Origem administrativa como eixo próprio, separada da localização física

| | |
| --- | --- |
| **Domínio** | domínio de Exumação/Transporte |
| **Descrição** | `P3` decide que a origem é informação própria, com três categorias, e que a **localização física** (Quadra Geral 1/2/3, terreno, rua) é **outro eixo** que não determina a modalidade tarifária |
| **Evidência** | nenhuma das três categorias existe no domínio; `burial_reference` é `TEXT` livre e mistura os dois eixos |
| **Decisão que o exige** | `P3`; Exumação tarifa, divergência 3.2 (agora encerrada) |
| **Representação atual** | nenhuma |
| **Impacto** | sem a origem, a modalidade tarifária não é resolvível — e derivá-la do destino é proibido |
| **Dependências** | — |
| **Risco** | `HIGH` |
| **FASE 4 REQUIRED** | **YES** |
| **Ressalva** | duas colisões de nome registradas em `P3` e **não resolvidas**: `OSSUARIO` existe como valor de **destino** e agora como categoria de **origem**; e a terceira categoria aparece como `OSSUARIO` em `P3` e `RETIRADA_OU_DESATIVACAO_DE_OSSUARIO` na decisão de tarifa. **Não** presumir identidade nem distinção — `P3` regra 5 mantém os eixos separados |

---

## Resumo por risco

```
CRITICAL   G01  G02  G03  G05  G12                          5
HIGH       G04  G06  G07  G08  G09  G10  G11  G19  G20      9
MEDIUM     G13  G16  G17  G18                               4
LOW        G14  G15                                         2
                                                           --
                                                  TOTAL    20
FASE 4 REQUIRED = YES                                      18
FASE 4 REQUIRED = NO                                        2
```

`G19` e `G20` **nascem do fechamento de P1–P6**: são o resíduo técnico das
decisões, e não pendências humanas. `P6` decidiu a vigência e deixou explícito
que a fonte não deve ser fabricada; `P3` decidiu que a origem é eixo próprio e
deixou o desenho para a Fase 4.

---

# 21. Decisões humanas ainda pendentes

```
DECISOES_HUMANAS_PENDENTES = 0
```

As seis pendências identificadas nesta auditoria foram **todas decididas** e
registradas em `docs/decisoes-humanas/2026-08-19-fechamento-p1-p6.md`. A tabela
original é preservada abaixo com o desfecho de cada uma — **o histórico do
achado não é apagado**.

| ID | Questão que estava aberta | Estado | Desfecho |
| --- | --- | --- | --- |
| **P1** | O que aciona a desativação do ossuário alugado, e se "abandono" segue caracterizado pela falta de renovação | **RESOLVIDA** | falta de renovação **não** caracteriza abandono automaticamente; desativação **não** é afirmada automaticamente; a Administração verifica. Nova faixa: até 1 ano não alertar; acima de 1 ano informar que a situação precisa ser verificada. **Supera** o item 7 da decisão de Exumação quanto à automaticidade |
| **P2** | Os códigos de modalidade levam ou não o prefixo `EXUMACAO_` | **RESOLVIDA** | **manter os códigos do catálogo**; o prefixo em documentação não é pedido de renomeação; `release_id` não muda por este motivo. Encerra a divergência 3.1 |
| **P3** | Como a situação de origem chega ao caso | **RESOLVIDA** | origem é **eixo próprio**, com `QUADRA_GERAL` / `JAZIGO_DE_FAMILIA` / `OSSUARIO`, separada de destino e de localização física; nunca derivar modalidade de número ou localização. Encerra a divergência 3.2 → **`G20`** |
| **P4** | A urna de R$ 250,00 deve ser assimétrica entre Quadra Geral e Jazigo | **RESOLVIDA** | a assimetria é **deliberada**: em Quadra Geral → cremação/outro cemitério a urna é **opcional** (R$ 351,67 sem, R$ 601,67 com); não adicionar automaticamente; não estender ao Jazigo. Encerra `O2` |
| **P5** | R$ 94,00 é um componente ou dois | **RESOLVIDA** | **mesma taxa interna**, com **contextos de aplicação diferentes** preservados; não duplicar. A regra ossuário → jazigo (somente R$ 106,57) permanece integral |
| **P6** | Vigência e fonte dos cinco valores novos | **RESOLVIDA** | vigência **01/01/2026 a 31/12/2026** para os cinco; fonte é decisão humana operacional, **sem fabricar documento** → **`G19`** |

## Resíduos técnicos gerados, que **não** são decisões humanas

| | |
| --- | --- |
| `G19` | proveniência: o catálogo exige `source_id`, e não existe tipo de fonte para decisão humana operacional |
| `G20` | origem administrativa como eixo próprio, separada da localização física |

Ambos são **desenho da Fase 4**. Nenhum deles exige nova regra operacional
humana.

## Duas colisões de nome registradas em `P3`, deliberadamente não resolvidas

```
OSSUARIO  como valor de DESTINO   (transport_destination, ja existe)
OSSUARIO  como categoria de ORIGEM (P3)

OSSUARIO                            (nome em P3)
RETIRADA_OU_DESATIVACAO_DE_OSSUARIO (nome na decisao de tarifa)
```

**Não são pendências humanas.** Pelo princípio estabelecido em `P2` — *nome
escrito em documentação não é pedido de renomeação de dado autoritativo* —, o
identificador publicado é escolha de publicação. A regra que **permanece
obrigatória** é a de `P3` regra 5: origem e destino são eixos separados, e a
modalidade nunca vem do destino.

## O que continua fora desta lista, com motivo

- *conteúdo oficial de preços, prazos e documentos* — já registrado como
  `A_CONFIRMAR` em `docs/dependencies-and-open-items.md`;
- *como representar solicitação, documentos, reclassificação, origem ou
  proveniência* — desenho técnico, projetável na Fase 4.

---

# 22. Resultado — gate pré-Fase 4

## A. Contradições funcionais

```
QUANTIDADE ENCONTRADA = 1
EM ABERTO             = 0
```

| ID | Severidade | Estado |
| --- | --- | --- |
| `C-01` — automaticidade da desativação do ossuário alugado | `MEDIUM` | **RESOLVIDA / SUPERADA por `P1`**; histórico preservado |

**Zero contradições em aberto.** Seis pontos de atenção (`A-01`–`A-06`) e duas
inconsistências de índice (`I-01`, `I-02`) auditados e classificados como
**não-contradições**. `A-02` (colisão de R$ 94,00) foi **decidida** por `P5`:
mesma taxa, contextos distintos preservados.

## B. `DOMAIN_MODEL_GAPS`

```
QUANTIDADE = 15   (13 + G19 e G20, nascidos do fechamento de P1-P6)
```

`G01` solicitação · `G02` criação de solicitação · `G03` reclassificação ·
`G04` documentos · `G05` Administração Provisória · `G06` eixos de restos ·
`G07` agendamento · `G08` componentes de cobrança · `G11` sessão × processo ·
`G12` assunto da solicitação · `G13` pós-venda · `G14` itens comerciais ·
`G15` localização física · **`G19` proveniência** · **`G20` origem como eixo
próprio**

## C. `CONVERSATIONAL_GAPS`

```
QUANTIDADE = 3
```

`G09` condição do fallback · `G16` primeira mensagem antes do menu ·
`G18` rota informativa para pergunta de preço

## D. `AUTHORITY_GAPS`

```
QUANTIDADE = 2
```

`G10` destinatários de encaminhamento · `G17` tópico não armazenado

Registro que a **fronteira de permissão está fechada e declarada** (`ai_boundary`,
`authoritative_signal_policy`, `pending_action.executor`, `handoff`). Os gaps de
autoridade são de **destinatário e de estado de espera** — não de o que o LLM
pode decidir.

## E. Decisões humanas pendentes

```
QUANTIDADE = 0
```

As seis pendências `P1`–`P6` foram **todas decididas** — ver §21 e
`docs/decisoes-humanas/2026-08-19-fechamento-p1-p6.md`. Nenhuma nova pendência
humana foi criada pelo fechamento: os dois resíduos (`G19`, `G20`) são desenho
técnico.

```
NAO EXISTE, NESTE MOMENTO, DECISAO HUMANA INDISPENSAVEL
PENDENTE PARA O PLANEJAMENTO OU PARA A PUBLICACAO.
```

## F. Riscos para a Fase 4

| # | Risco | Severidade | Mitigação |
| --- | --- | --- | --- |
| R1 | **Unificar prematuramente** as seis formas de solicitação numa abstração única, escondendo pares que a decisão exige separados (taxa-solicitada × taxa-paga; agendamento-pedido × confirmado; venda × acompanhamento) | `CRITICAL` | §10 lista as seis diferenças; desenhar a partir delas, não a partir do denominador comum |
| R2 | Implementar a **Administração Provisória** e, ao fazê-lo, **remover a proteção por ausência** que hoje impede confundi-la com Concessão | `CRITICAL` | separação explícita desde o primeiro desenho de `G05` |
| R3 | Implementar `G03` como `NEW_GOAL` "porque é o que mais se parece" — o que **viola** a decisão que `G03` existe para atender | `HIGH` | o invariante *"nunca reutiliza facts de outro case"* é o teste; se ele dispara, o desenho está errado |
| R4 | Implementar `G09` usando `UNCERTAIN`, colapsando incerteza do sistema com incerteza do munícipe | `HIGH` | são objetos distintos (§14) |
| R5 | Publicar componentes de cobrança sem proveniência válida — ou **fabricar** portaria, decreto ou URL para preencher o campo `source_id` | `HIGH` | `P6` decidiu a vigência e **proibiu** inventar fonte; resolver por `G19`, estendendo o modelo de proveniência |
| R9 | Colapsar `OSSUARIO`-origem com `OSSUARIO`-destino por coincidência de texto, reintroduzindo exatamente o erro que `MAP_MODALIDADE_TARIFARIA` existe para impedir | `HIGH` | `P3` regra 5: eixos separados; `G20` registra a colisão sem resolvê-la |
| R10 | Inferir `QUADRA_GERAL` a partir de um número de quadra informado pelo munícipe — uma numeração de quadra também pertence a Jazigo de Família | `HIGH` | `P3` proíbe explicitamente; `P3` regra 4 |
| R6 | Tratar a mudança de `release_id` como regressão: os vetores antigos passam a `INVALIDO`, que é **esperado** | `MEDIUM` | já documentado; `INVALIDO` ≠ `FAIL`; congelados não se reescrevem |
| R7 | "Harmonizar" os sete documentos consolidados para eliminar `I-01`/`I-02` | `MEDIUM` | proibido por §23; a auditoria é o lugar do registro |
| R8 | Enriquecer o Comercial além do básico sem decisão, tratando `A1` como lacuna | `LOW` | `A1` declara o escopo básico como **escolhido** |

## G. Ordem de implementação recomendada

Derivada das dependências declaradas em §20 — `G01` é raiz de nove gaps.

```
1  G01 + G12    solicitacao com assunto legivel, categoria, motivo e estado
2  G02          as seis formas de criacao, preservadas como seis
3  G11          vinculo sessao x processo, e a garantia de nao-apagamento
4  G04          documentos com identidade e estado proprio
5  G10          catalogo de acoes: encaminhar, protocolar, acompanhar, aguardar
6  G17 -> G03   topico armazenado, depois reclassificacao com vinculo
7  G09 + G16 + G18   condicao do fallback, primeira mensagem, rota informativa
8  G06 + G07    eixos de restos e os tres estados de agendamento
9  G20          origem administrativa como eixo proprio (habilita a tarifa)
10 G19 + G08    proveniencia, depois componentes -> novo release_id -> conformidade
11 G05          Administracao Provisoria como instrumento
12 G13          ciclo de acompanhamento pos-venda
13 G14 + G15    enriquecimento comercial e localizacao fisica  (opcionais)
```

Justificativa das três posições menos óbvias:

- **`G11` em terceiro**, antes de documentos e ações: é a garantia que o munícipe
  percebe primeiro e a única hoje sem dono declarado.
- **`G17` antes de `G03`**: sem tópico armazenado não há vínculo a preservar, e
  `G03` sem vínculo vira `NEW_GOAL` — exatamente o risco `R3`.
- **`G08` em nono**, apesar de `HIGH`: altera `release_id` e invalida os vetores.
  Fazê-lo cedo obrigaria a reconformar o conjunto a cada iteração seguinte. Ele
  também depende de `P6`.

- **`G20` antes de `G08`**: a origem é o que **seleciona** a modalidade
  tarifária. Publicar componentes sem o eixo de origem deixaria a tarifa sem
  quem a resolva, e a alternativa proibida — derivar do destino — é justamente o
  erro que `P3` regra 4 e `MAP_MODALIDADE_TARIFARIA` vedam.
- **`G19` imediatamente antes de `G08`**: sem tipo de fonte válido, publicar os
  cinco valores exigiria fabricar proveniência, o que `P6` proíbe.

`G05` em décimo primeiro **não** é despriorização: é o gap mais arriscado (`R2`), e
precisa da solicitação, dos documentos e das ações já estabilizados para ser
desenhado sem improviso.

## H. `PRE_PHASE_4_GATE`

```
PRE_PHASE_4_GATE = PASS
```

| Critério | Situação |
| --- | --- |
| conhecimento funcional suficientemente consolidado | **sim** — sete tópicos, sete documentos, cadeia de commits íntegra |
| contradições críticas inexistentes ou resolvidas | **sim** — a única contradição (`C-01`, `MEDIUM`) está **resolvida** por `P1`; **zero em aberto** |
| gaps identificados | **sim** — 20, deduplicados, com evidência, dependência e risco |
| Fase 4 pode ser planejada com segurança | **sim** — com os riscos `R1`–`R10` explícitos |
| decisões humanas indispensáveis pendentes | **nenhuma** — `P1`–`P6` fechadas |

```
PASS NAO AUTORIZA IMPLEMENTACAO.
FASE 4 NAO FOI INICIADA NESTA TAREFA.
```

O `PASS` era anterior ao fechamento de `P1`–`P6` e **continua válido, agora mais
forte**: a contradição foi resolvida, as seis pendências humanas foram decididas,
e os dois resíduos gerados (`G19`, `G20`) são desenho técnico, não decisão.

A publicação dos dados autoritativos deixou de depender de decisão humana e passa
a depender de `G19` (proveniência) e `G20` (origem) — ambos projetáveis na
Fase 4.

---

# Fontes canônicas desta auditoria

| | |
| --- | --- |
| Decisões humanas dos sete tópicos | `docs/decisoes-humanas/2026-08-19-*.md` |
| Estado conversacional | `santana-conversation-domain/state.schema.json` |
| Tópicos, goals, relações, fatos, perguntas | `santana-conversation-domain/*.v1.json` |
| Eventos e sinal autoritativo | `santana-conversation-domain/conversation-events.v1.json` |
| Fronteira de IA e política autoritativa | `santana-conversation-domain/facts.v1.json` |
| Fixtures de interpretação | `santana-conversation-domain/runtime/fixtures/messages.v1.json` |
| Desenho de persistência | `santana-conversation-domain/persistence-design-review.md` |
| Sessão, inatividade e limites de blueprint | `docs/blueprint-binding.md`, `docs/legacy-new-mapping.md`, `docs/security-review.md` |
| Itens `A_CONFIRMAR` | `docs/dependencies-and-open-items.md` |
| Catálogo autoritativo | `santana-authority/catalogo/exumacao.v1.json` |
| Contratos R1–R6 e vetores | `docs/fase2/CONTRATOS-R1-R6.md`, `conformidade/vetores/FORMATO.md` |
| Estado operacional | `docs/HANDOFF-PROJETO-SANTANA.md` |
