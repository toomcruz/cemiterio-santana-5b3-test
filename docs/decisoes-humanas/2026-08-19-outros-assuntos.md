# Decisão humana — OUTROS ASSUNTOS

```
DATA          2026-08-19
DECISOR       mantenedor do projeto
ESCOPO        OUTROS ASSUNTOS: papel de intencao invisivel / rede de seguranca,
              exemplos de demanda, resposta direta, ausencia de resposta segura,
              preservacao do motivo real, proibicao de forcar classificacao,
              demanda mal explicada, migracao para topico especializado e
              relacao com Reclamacoes
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
```

Este documento **registra** decisões. Ele **não** altera runtime, catálogo
autoritativo, domínio, schemas, contratos, enums, vetores, referência Python,
Gateway TS/Deno, workflows, Supabase, n8n nem `release_id`. Nada aqui está em
vigor até ser publicado e validado.

## Como ler este documento

```
A) DECISAO HUMANA APROVADA        texto do decisor, transcrito. E regra.
B) REQUISITO CONVERSACIONAL       comportamento de atendimento. NAO e regra
                                  juridica nem administrativa.
C) GAP / REQUISITO TECNICO FUTURO lacuna do modelo tecnico. NAO e decisao
                                  pendente: e implementacao pendente.
```

Nada foi inferido, completado ou "arrumado" ao transcrever. Onde a decisão não
diz, este documento não diz.

## O que já existia e NÃO foi recriado

O tópico **já existe** e foi preservado integralmente:

| Já existente | Onde |
| --- | --- |
| Tópico `OUTROS_ASSUNTOS` — "Outros Assuntos", `layer: BASE`, **`fallback: true`**, capacidade `INFORMACAO_GERAL`, **sem entidades** | `santana-conversation-domain/topics.v1.json` |
| `GOAL_OUTROS_ASSUNTOS`, **`creates_case: false`**, exigindo `other_subject_description` | `santana-conversation-domain/goals.v1.json` |
| `other_subject_description` — "Descricao do assunto", escopo `GOAL`, tipo `TEXT`, fontes `USER_EXPLICIT` / `USER_CORRECTION` | `santana-conversation-domain/facts.v1.json` |
| `Q_OTHER_SUBJECT` — *"Sobre qual assunto voce precisa de ajuda?"* | `santana-conversation-domain/questions.v1.json` |
| Goals informativos `GOAL_INFO_OSSUARIO` e `GOAL_INFO_HORARIO`, ambos sob `OUTROS_ASSUNTOS`, `informational: true`, `creates_case: false` | `santana-conversation-domain/goals.v1.json` |
| Declaração de que perguntas paralelas informativas **não são tópicos e não criam case** | `santana-conversation-domain/topics.v1.json` |
| Evento `UNCERTAIN` — invariantes `nao presumir valor` e `incerteza bloqueadora tem prioridade 3` | `santana-conversation-domain/conversation-events.v1.json` |
| `REL_RECLAMACAO_OVERLAY` e o evento `COMPLAINT`, que governam §10 | `santana-conversation-domain/relations.v1.json`, `conversation-events.v1.json` |

Decisões relacionadas, do mesmo dia: `2026-08-19-exumacao-tarifa-vigencia.md`,
`2026-08-19-exumacao-procedimento.md`,
`2026-08-19-recadastro-sucessao-administracao-provisoria.md`,
`2026-08-19-transporte-falecidos-e-restos-mortais.md`,
`2026-08-19-processo-de-concessao.md`,
`2026-08-19-comercial-basico-e-reclamacoes.md`.

Com este documento, os **sete** tópicos do atendimento estão consolidados.

---

# A) DECISÕES HUMANAS APROVADAS

## A1. Papel de OUTROS ASSUNTOS

**DECISÃO HUMANA APROVADA**

OUTROS ASSUNTOS funciona como **intenção invisível / rede de segurança** do
atendimento.

```
NAO deve ser usado simplesmente porque o classificador ficou incerto.
```

Deve ser utilizado quando a demanda **não pertencer com segurança** aos tópicos
especializados já consolidados:

- Exumação;
- Recadastro;
- Transporte de Falecidos e Restos Mortais;
- Processo de Concessão;
- Comercial;
- Reclamações e Ocorrências.

A distinção é o núcleo da decisão, e ela **não é a mesma coisa**:

```
CLASSIFICADOR INCERTO        -> estado do sistema
DEMANDA QUE NAO PERTENCE     -> propriedade da demanda
```

Uma demanda pode pertencer com clareza a Exumação e ainda assim deixar o
classificador incerto; nesse caso OUTROS ASSUNTOS **não é a resposta**.

## A2. Exemplos de demandas — lista aberta

**DECISÃO HUMANA APROVADA**

OUTROS ASSUNTOS pode abranger, **conforme o contexto**:

- dúvidas administrativas gerais;
- comunicados recebidos;
- nota fiscal;
- e-mails e contatos;
- pedidos de informação não contemplados pelos tópicos especializados;
- situações administrativas incomuns;
- solicitações diversas que necessitem atuação da Administração.

**Os exemplos NÃO devem ser tratados como lista fechada.**

## A3. Quando não houver resposta segura

**DECISÃO HUMANA APROVADA**

Quando OUTROS ASSUNTOS não possuir resposta segura/autorizada:

- **entender resumidamente** a necessidade;
- **preservar o motivo original**;
- **coletar somente os dados realmente necessários**;
- **abrir uma solicitação para a ADMINISTRAÇÃO** dar continuidade.

```
Nao inventar resposta.
Nao forcar o municipe para outro topico apenas para obter classificacao.
```

## A4. Preservar o assunto real

**DECISÃO HUMANA APROVADA**

OUTROS ASSUNTOS **pode ser a classificação/intenção técnica**, mas a solicitação
**não deve perder o motivo real**.

Evitar registros genéricos como **"Outros Assuntos"** quando o sistema **já
conhece** a necessidade específica.

| Evitar | Preferir |
| --- | --- |
| "Outros Assuntos" | "Dúvida sobre comunicado recebido" |
| "Outros Assuntos" | "Solicitação de nota fiscal" |
| "Outros Assuntos" | "Dúvida administrativa sobre [assunto informado]" |

O objetivo é permitir que a Administração **entenda a demanda sem depender de
reconstruir toda a conversa**.

```
INTENCAO TECNICA  !=  MOTIVO REAL DA SOLICITACAO
```

## A5. Não forçar classificação

**DECISÃO HUMANA APROVADA**

> Munícipe: *"Recebi uma carta do cemitério e não sei do que se trata."*

O robô **NÃO** deve inferir automaticamente Exumação, Recadastro, Concessão ou
Comercial **apenas porque o comunicado possa eventualmente estar relacionado** a
um desses processos.

Primeiro deve tratar **o conteúdo efetivamente informado**:

```
-> duvida sobre comunicado
```

Se **posteriormente** surgirem evidências suficientes de um tópico especializado,
o atendimento **pode atualizar a classificação** sem reiniciar desnecessariamente
a conversa.

Esta é a mesma proibição que governa todo o projeto, aplicada à classificação:
inferência por semelhança não é conhecimento, e **o LLM não pode ser autoridade
administrativa**.

## A6. Mudança para tópico especializado

**DECISÃO HUMANA APROVADA**

Se durante OUTROS ASSUNTOS surgirem informações suficientes para identificar com
segurança um tópico especializado:

- **atualizar o contexto**;
- **preservar informações já obtidas**;
- **continuar pelo tópico correto**;
- **NÃO reiniciar o atendimento do zero.**

## A7. Relação com Reclamações

**DECISÃO HUMANA APROVADA**

OUTROS ASSUNTOS **NÃO deve absorver automaticamente reclamações**.

Havendo insatisfação/falha de serviço **suficientemente caracterizada**:

- **preservar o assunto original**;
- **aplicar a intenção invisível de Reclamação**, conforme a consolidação
  correspondente.

```
Nao transformar Reclamacao em Outros Assuntos apenas porque
nao existe setor especifico de reclamacoes.
```

Os dois tópicos são **intenções invisíveis**, e é justamente por isso que a
decisão precisa separá-los. A diferença é estrutural e já está no domínio:

| | OUTROS ASSUNTOS | RECLAMAÇÕES |
| --- | --- | --- |
| camada | `layer: BASE`, `fallback: true` | `layer: OVERLAY` |
| relação com o assunto | **é** o assunto quando nenhum outro serve | **acompanha** o assunto-base, sem substituí-lo |
| efeito de aplicar errado | perde-se a natureza de reclamação | — |

Reclamação **não é ausência de tópico**: é uma camada sobre um tópico. A
ausência de setor exclusivo — registrada em `A8` da decisão de Comercial e
Reclamações — **não** é motivo para reclassificar.

---

# B) REQUISITOS CONVERSACIONAIS

Comportamento de atendimento. **Nada aqui é regra jurídica ou administrativa**, e
nada aqui pode ser convertido em regra administrativa sem decisão humana
específica.

## B1. Resposta direta

**REQUISITO CONVERSACIONAL**

Havendo resposta **segura e autorizada** no conhecimento disponível:

```
-> responder diretamente
```

**Não abrir solicitação desnecessariamente** quando a demanda puder ser resolvida
de forma segura pelo próprio atendimento automatizado.

As duas condições — **segura** e **autorizada** — são cumulativas. "Autorizada"
significa vinda de fonte oficial carregada, e não de conhecimento geral do
modelo. Sem isso, vale `A3`.

Os goals informativos já existentes (`GOAL_INFO_OSSUARIO`, `GOAL_INFO_HORARIO`,
ambos `creates_case: false`) são a forma que o domínio já dá a este requisito
para dois assuntos específicos.

## B2. Demanda mal explicada

**REQUISITO CONVERSACIONAL**

Se o munícipe não conseguir explicar claramente o que precisa:

- fazer **perguntas curtas e úteis**;
- **não exigir** conhecimento de terminologia interna;
- **não apresentar** um questionário extenso;
- **tentar compreender o objetivo real** da pessoa.

Se ainda assim não houver classificação/resposta segura:

```
-> abrir solicitacao para a Administracao, preservando o relato disponivel
```

Isto conversa com o contrato **R6** (uma pergunta pendente por turno) e com o
requisito, já registrado em Concessão, de que **o fluxo não é questionário
rígido**.

## B3. Não empurrar o munícipe para caber

**REQUISITO CONVERSACIONAL**

Perguntar para **entender** é diferente de perguntar para **encaixar**. `A3` e
`A5` proíbem a segunda: nenhuma pergunta existe para obter classificação que a
demanda não sustenta.

---

# C) GAP / REQUISITO TÉCNICO FUTURO

```
DOMAIN_MODEL_GAP / DECIDED_KNOWLEDGE_AWAITING_FUTURE_IMPLEMENTATION
```

Auditoria pedida em §11, item a item.

| O que precisa ser representado | Representação hoje |
| --- | --- |
| intenção técnica `OUTROS ASSUNTOS` | **existe** — tópico `OUTROS_ASSUNTOS` com `fallback: true` e `GOAL_OUTROS_ASSUNTOS` |
| motivo real da demanda | **parcial** — `other_subject_description` é `TEXT` livre, escopo `GOAL`; ver `C1` |
| resumo/assunto da solicitação | **não existe** — ver `C2` |
| encaminhamento para a Administração | **não existe** como ação; ver `C3` |
| eventual reclassificação posterior | **não existe**; ver `C4` |
| vínculo com o contexto original | **parcial**; ver `C4` |

**O conhecimento humano está decidido.** O gap é do modelo técnico.

## C1. Motivo real existe como texto, não como assunto

`other_subject_description` guarda o relato do munícipe. É `TEXT` livre, de
escopo `GOAL`, alimentado por `USER_EXPLICIT` / `USER_CORRECTION`.

Isso **cobre parcialmente** `A4`: o motivo é retido. O que **não** existe é a
distinção que `A4` faz entre **o relato** e **o assunto da solicitação** — os
exemplos "Dúvida sobre comunicado recebido" e "Solicitação de nota fiscal" são
**rótulos derivados** do relato, não o relato em si.

```
RELATO DO MUNICIPE   !=   ASSUNTO DA SOLICITACAO
```

Um é o que a pessoa disse; o outro é o que a Administração lê primeiro. `A4`
pede o segundo, e ele não existe.

## C2. `GOAL_OUTROS_ASSUNTOS` não cria solicitação

`A3` determina **abrir uma solicitação para a Administração**.
`GOAL_OUTROS_ASSUNTOS` tem **`creates_case: false`** e o tópico declara
`entities: []`.

Não é contradição — o goal existe para conduzir a conversa, não para protocolar —
mas **nada no domínio representa a solicitação que `A3` manda abrir**, nem seu
assunto, nem seu estado.

Este é o **mesmo gap** já registrado em `C1` da decisão de Processo de Concessão
e em `C1`/`C2` da decisão de Comercial e Reclamações: **estado de solicitação e
acompanhamento não representados**. Ele aparece agora pelo terceiro tópico
diferente. **Não os unifiquei**: a decisão de como representar solicitação é uma
só, e não é minha.

## C3. Encaminhamento à Administração não é uma ação declarada

O domínio conhece quatro ações — `ACTION_VERIFY_GRAVE_SITUATION`,
`ACTION_COLLECT_GRAVE_AUTHORIZATION`, `ACTION_COLLECT_EXHUMATION_AUTHORIZATION`,
`ACTION_VERIFY_RECADASTRO` — todas específicas de verificação ou coleta. Nenhuma
delas é **"encaminhar demanda genérica à Administração para continuidade"**, que
é o que `A3` e `B2` pedem.

Mesmo gap de `C2` da decisão de Concessão (Setor de Concessões) e de `C3` da
decisão de Comercial (setor comercial), agora com a Administração como
destinatário. **Não criei a ação.**

## C4. Reclassificação posterior não é representada

`A5` e `A6` decidem que a classificação **pode ser atualizada** quando surgirem
evidências, **sem reiniciar** o atendimento, **preservando** o que já foi obtido.

O domínio tem eventos vizinhos, e **nenhum** é este:

| Evento existente | O que faz | Por que não serve |
| --- | --- | --- |
| `CORRECTION` | corrige o **valor de um fato** | a classificação do tópico não é um fato |
| `CHANGE_OF_MIND` | o munícipe **muda de ideia** | em `A6` a necessidade não mudou — o entendimento dela melhorou |
| `NEW_GOAL` | novo objetivo real, **cria case quando o sujeito difere**, com o invariante *"nunca reutiliza facts de outro case"* | `A6` exige exatamente o contrário: **preservar** as informações já obtidas |

O invariante de `NEW_GOAL` é o ponto mais afiado: tratar `A6` como `NEW_GOAL`
faria o atendimento **perder** o que já sabia, que é precisamente o que `A6`
proíbe. E não há, hoje, representação do **vínculo** entre a conversa iniciada em
OUTROS ASSUNTOS e o tópico especializado para onde ela migrou.

> **Isto é descrição do gap.** Não é enum, não é schema, não é código, e **não
> deve ser transformado em nenhum dos três nesta tarefa.**

## C5. `fallback: true` está declarado, sua condição de disparo não

`topics.v1.json` marca `OUTROS_ASSUNTOS` com `fallback: true`. **Nenhum arquivo
versionado define quando essa flag dispara** — verificado por varredura do
domínio, do motor e do runtime. As ocorrências de `fallback` no runtime
(`adapter.ts`, `LLM-ADAPTER.md`) são do adaptador de LLM caindo para o mock, e
**não têm relação** com roteamento de tópico.

`A1` é justamente a decisão que define esse disparo — e o define pela **negativa
mais importante**: não é a incerteza do classificador.

Registro que o domínio tem um evento `UNCERTAIN`, e que ele **não é** o caso de
`A1`: `UNCERTAIN` descreve *"usuario declara desconhecimento ou duvida sobre um
fato"*, com o invariante `nao presumir valor`. É incerteza **do munícipe sobre um
fato**, não incerteza **do sistema sobre o tópico**. **Não os tratei como o mesmo
conceito**, e implementá-los como se fossem confundiria as duas coisas que `A1`
separa.

---

# Auditoria de contradições

Varredura sobre `docs/`, `santana-conversation-domain/`, `santana-authority/` e
`santana-authority-gateway/`.

| Ponto auditado | Resultado |
| --- | --- |
| OUTROS ASSUNTOS como intenção invisível | **nenhuma contradição.** O tópico existe com `fallback: true` e capacidade `INFORMACAO_GERAL`; nada o descreve como opção de menu obrigatória |
| resposta direta quando houver conhecimento seguro | **nenhuma contradição — concordância.** `GOAL_INFO_OSSUARIO` e `GOAL_INFO_HORARIO` já são goals informativos com `creates_case: false`, e `topics.v1.json` declara que perguntas informativas não criam case |
| abrir solicitação para a Administração sem resposta segura | **nenhuma contradição — concordância de princípio.** `docs/blueprint-binding.md` registra que `A_CONFIRMAR` não pode resolver preço, prazo, SLA ou documento obrigatório; `docs/legacy-new-mapping.md` registra que ausência de regra resulta em `A_CONFIRMAR`. Nenhum documento autoriza responder sem fonte |
| preservação do motivo real | **nenhuma contradição.** `other_subject_description` existe justamente para reter o relato; nada manda descartá-lo |
| possibilidade de reclassificação posterior | **nenhuma contradição.** Nenhum documento proíbe reclassificar. O invariante *"nunca reutiliza facts de outro case"* pertence a `NEW_GOAL` e trata de **cases diferentes** — não proíbe atualizar a classificação dentro do mesmo atendimento; ver ponto de atenção abaixo |
| separação entre OUTROS ASSUNTOS e RECLAMAÇÃO | **nenhuma contradição — concordância estrutural.** `RECLAMACOES` é `layer: OVERLAY` com `requires_base_goal: true` e `replaces_base_goal: false`; `OUTROS_ASSUNTOS` é `layer: BASE`. O domínio já os torna incapazes de se substituírem |

**Nenhuma contradição encontrada. Nenhum conflito material exigindo nova decisão
humana.**

## Pontos de atenção que **não** são contradições

**1. `NEW_GOAL` e o invariante de não reutilizar fatos.** `A6` manda preservar
informações ao migrar para um tópico especializado; `NEW_GOAL` declara *"nunca
reutiliza facts de outro case"*. **Não é conflito**: o invariante protege a
fronteira entre **cases distintos** — dois falecidos, dois jazigos —, enquanto
`A6` descreve **a mesma demanda** sendo melhor compreendida. Registro porque
implementar `A6` **como** `NEW_GOAL` violaria `A6`; ver `C4`. Não alterei nem o
evento nem a decisão.

**2. `fallback: true` e `A1`.** A flag existe; sua condição de disparo não está
definida em lugar nenhum. `A1` a define, e a define excluindo a incerteza do
classificador. **Não é contradição** — é ausência de definição prévia. Tratado
em `C5`.

---

# O que estas decisões NÃO autorizam

- Não autorizam rotear para OUTROS ASSUNTOS por incerteza do classificador.
- Não autorizam inferir tópico especializado por associação temática (`A5`).
- Não autorizam registrar solicitação apenas como "Outros Assuntos" quando o
  motivo real é conhecido (`A4`).
- Não autorizam responder sem fonte segura e autorizada (`B1`).
- Não autorizam abrir solicitação quando a resposta direta é segura (`B1`).
- Não autorizam perguntar para obter classificação (`A3`, `B3`).
- Não autorizam absorver reclamação em OUTROS ASSUNTOS (`A7`).
- Não autorizam reiniciar o atendimento ao mudar de tópico (`A6`).
- Não autorizam tratar os exemplos de `A2` como lista fechada.
- Não autorizam criar enum, schema, fato, evento ou ação para os gaps `C1`–`C5`.
- Não autorizam tratar `UNCERTAIN` como o mecanismo de `A1`.
- Não autorizam reescrever os vetores congelados da Fase 2.
- Não autorizam iniciar a Fase 4.

---

# Fontes canônicas

| | |
| --- | --- |
| Tópicos, goals, fatos e perguntas | `santana-conversation-domain/topics.v1.json`, `goals.v1.json`, `facts.v1.json`, `questions.v1.json` |
| Eventos `UNCERTAIN`, `NEW_GOAL`, `CHANGE_OF_MIND`, `CORRECTION`, `COMPLAINT` | `santana-conversation-domain/conversation-events.v1.json` |
| `REL_RECLAMACAO_OVERLAY` | `santana-conversation-domain/relations.v1.json` |
| Princípio de ausência de regra ⇒ `A_CONFIRMAR` | `docs/blueprint-binding.md`, `docs/legacy-new-mapping.md` |
| Decisões humanas anteriores | `docs/decisoes-humanas/` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Estado operacional do projeto | `docs/HANDOFF-PROJETO-SANTANA.md` |
