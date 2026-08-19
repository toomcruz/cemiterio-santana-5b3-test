# Decisão humana — COMERCIAL (versão básica) e RECLAMAÇÕES E OCORRÊNCIAS

```
DATA          2026-08-19
DECISOR       mantenedor do projeto
ESCOPO        COMERCIAL em versao basica: aquisicao de jazigo, lapide,
              zeladoria, portao/tranca, reforma/construcao e a regra geral;
              RECLAMACOES E OCORRENCIAS: intencao invisivel, categoria
              operacional, ausencia de gravidade automatica e preservacao do
              assunto original
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
COMERCIAL     BASIC_CONSOLIDATED / FUTURE_ENRICHMENT_ALLOWED
```

Este documento **registra** decisões. Ele **não** altera runtime, catálogo
autoritativo, domínio, schemas, contratos, enums, vetores, referência Python,
Gateway TS/Deno, workflows, Supabase nem n8n. Nada aqui está em vigor até ser
publicado e validado.

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

Ambos os tópicos **já existem** e foram preservados. Reclamações, em particular,
é o tópico **mais completamente representado** do domínio: quase toda a decisão
de §2 já está versionada.

| Já existente | Onde |
| --- | --- |
| Tópico `COMERCIAL`, capacidades `LAPIDE`, `JAZIGO`, `OSSUARIO`, `CINZAS`, `ZELADORIA` | `santana-conversation-domain/topics.v1.json` |
| `GOAL_COMERCIAL`, `creates_case: true`, sujeito `ORDER` | `santana-conversation-domain/goals.v1.json` |
| `commercial_item` = `LAPIDE` / `JAZIGO` / `OSSUARIO` / `CINZAS` / `ZELADORIA` | `santana-conversation-domain/facts.v1.json` |
| `commercial_stage` = `ORCAMENTO` / `PEDIDO_PAGO` / `PEDIDO_NAO_PAGO` | idem |
| `commercial_delivery_status` = `NAO_APLICAVEL` / `PENDENTE` / `INSTALADO`, relevante só quando há pedido | idem |
| Tópico `RECLAMACOES` — "Reclamacoes e Ocorrencias", **`layer: OVERLAY`** | `santana-conversation-domain/topics.v1.json` |
| `overlay_rules`: `requires_base_goal`, `creates_base_goal_when_absent`, `replaces_base_goal: false`, **`automatic_severity_classification: false`** | idem |
| `GOAL_RECLAMACAO`, `overlay: true`, **`creates_case: false`** | `santana-conversation-domain/goals.v1.json` |
| `REL_RECLAMACAO_OVERLAY` — anexa ao goal-base, cria o base quando ausente, **base permanece ativo**, sem gravidade automática | `santana-conversation-domain/relations.v1.json` |
| Evento `COMPLAINT`, com `forbidden`: `automatic_severity_classification` e `replace_base_goal` | `santana-conversation-domain/conversation-events.v1.json` |
| `complaint_description`, escopo `GOAL` | `santana-conversation-domain/facts.v1.json` |

Decisões relacionadas, do mesmo dia: `2026-08-19-exumacao-tarifa-vigencia.md`,
`2026-08-19-exumacao-procedimento.md`,
`2026-08-19-recadastro-sucessao-administracao-provisoria.md`,
`2026-08-19-transporte-falecidos-e-restos-mortais.md`,
`2026-08-19-processo-de-concessao.md`.

---

# PARTE 1 — COMERCIAL (versão básica)

```
BASIC_CONSOLIDATED / FUTURE_ENRICHMENT_ALLOWED
```

## A) DECISÕES HUMANAS APROVADAS

### A1. Escopo deliberadamente básico

**DECISÃO HUMANA APROVADA**

O Comercial fica **deliberadamente em versão básica** nesta etapa.

**Não aprofundar agora** fluxos complexos de pós-venda, reforma, orçamento ou
catálogo.

Isto **não** é lacuna nem pendência de decisão: é **escopo escolhido**. O
enriquecimento futuro está **permitido** e não requer retratar nada deste
documento.

### A2. Aquisição de jazigo

**DECISÃO HUMANA APROVADA**

Quando o munícipe demonstrar interesse em adquirir um jazigo, o robô **pode
perguntar** se ele deseja saber sobre:

- catálogo;
- formas de pagamento;
- informações sobre jazigos;

e **depois deve abrir uma solicitação** para contato do setor/representante
comercial.

**O robô NÃO fecha a venda sozinho.**

### A3. Lápide

**DECISÃO HUMANA APROVADA** — preserva valores e condições já consolidados.

| Situação | Comportamento |
| --- | --- |
| **interesse em compra** | informar o que já estiver autorizado; abrir solicitação quando aplicável |
| **pós-venda** — lápide comprada e não instalada, demora, problema no serviço | **NÃO tratar como nova venda**; abrir **solicitação de acompanhamento** |

### A4. Zeladoria

**DECISÃO HUMANA APROVADA** — preserva o plano e os valores já consolidados.

Quando o munícipe quiser contratar:

- informar o que já estiver autorizado;
- abrir solicitação conforme o fluxo existente.

**Portão / tranca:**

- **pertencem a Zeladoria**;
- **não possuem valor fixo consolidado** nesta etapa;
- abrir solicitação para que o valor/orçamento seja informado.

### A5. Reforma / construção

**DECISÃO HUMANA APROVADA**

- **não aprofundar o fluxo** nesta etapa;
- abrir solicitação para continuidade pelo setor responsável/comercial.

### A6. Regra geral do Comercial

**DECISÃO HUMANA APROVADA**

```
QUER COMPRAR / CONTRATAR
  -> orientar o que ja esta autorizado
  -> abrir solicitacao quando necessario

JA COMPROU / JA CONTRATOU
  -> nao vender novamente
  -> abrir solicitacao de acompanhamento

SERVICO SEM PRECO FIXO CONSOLIDADO
  -> nao inventar valor
  -> abrir solicitacao para orcamento/valor
```

A terceira regra é a aplicação, no Comercial, do princípio que governa todo o
projeto: **o LLM não pode ser autoridade administrativa**, e valor sem fonte
oficial não é inventado — é encaminhado.

---

# PARTE 2 — RECLAMAÇÕES E OCORRÊNCIAS

## A) DECISÕES HUMANAS APROVADAS

### A7. Intenção invisível

**DECISÃO HUMANA APROVADA**

- Reclamações funcionam como **intenção invisível**.
- **Não precisam** obrigatoriamente aparecer como opção principal do menu.
- O robô deve **reconhecer reclamação pela linguagem/contexto** do munícipe.
- **Não exigir** que o munícipe diga literalmente "quero reclamar".

### A8. Não existe setor exclusivo de reclamações

**DECISÃO HUMANA APROVADA**

- **Não existe setor exclusivo** de reclamações.
- Reclamações geram uma **solicitação normal no sistema**.
- A solicitação deve ser **categorizada como `RECLAMAÇÃO`**.

### A9. Sem classificação automática de gravidade

**DECISÃO HUMANA APROVADA**

**Não criar classificação automática de gravidade.**

Esta decisão já está representada em **quatro lugares** do domínio, e todos
foram preservados: `overlay_rules.automatic_severity_classification: false`,
`REL_RECLAMACAO_OVERLAY.rules.automatic_severity_classification: false`, o
`forbidden` do evento `COMPLAINT`, e o invariante `I12` do desenho de
persistência.

### A10. Reclamação pode estar associada a qualquer assunto

**DECISÃO HUMANA APROVADA**

Por exemplo:

- lápide não instalada;
- zeladoria não executada;
- reforma atrasada;
- falta de retorno;
- atendimento;
- demora;
- outro serviço contratado não executado.

### A11. Preservar o contexto original do assunto

**DECISÃO HUMANA APROVADA**

> "Comprei uma lápide e não instalaram"

**não deve virar apenas "Comercial"**. É um problema relacionado à **lápide**,
que precisa gerar acompanhamento/reclamação **conforme o contexto**.

O robô **NÃO** deve:

- criar setor fictício de reclamações;
- inventar gravidade;
- bloquear o atendimento por ausência de categoria específica;
- **apagar o assunto original** da reclamação.

Esta decisão é exatamente o que o domínio já implementa: a reclamação é
**camada sobre o assunto-base**, e não substituição dele. O exemplo declarado em
`REL_RECLAMACAO_OVERLAY` é literalmente o mesmo caso:

```
Lapide comprada e nao instalada
  => assunto-base GOAL_COMERCIAL (commercial_item = LAPIDE)
   + overlay GOAL_RECLAMACAO
```

E a fixture `M08` — *"paguei a lápide faz meses e até hoje não colocaram, isso é
um absurdo"* — já espera `primary_event: COMPLAINT`, `goal: GOAL_COMERCIAL`,
`commercial_item = LAPIDE`, `commercial_stage = PEDIDO_PAGO`,
`commercial_delivery_status = PENDENTE`. O assunto original é preservado nos
fatos; a reclamação vem por cima.

---

# B) REQUISITOS CONVERSACIONAIS

Comportamento de atendimento. **Nada aqui é regra jurídica ou administrativa**, e
nada aqui pode ser convertido em regra administrativa sem decisão humana
específica.

## B1. Reconhecimento por linguagem, não por menu

**REQUISITO CONVERSACIONAL**

A reclamação é reconhecida pelo que o munícipe diz e pelo contexto, e não por
uma opção que ele precise escolher. A ausência da opção no menu **é a decisão**
(A7), e não uma limitação a contornar.

## B2. Comprar × acompanhar

**REQUISITO CONVERSACIONAL**

| O munícipe diz | O robô faz |
| --- | --- |
| quer comprar / contratar | orienta o autorizado, abre solicitação quando necessário |
| **já comprou / já contratou** | **não reabre venda**; abre solicitação de acompanhamento |
| pergunta valor de serviço sem preço fixo | **não estima**; abre solicitação para orçamento |

A distinção entre as duas primeiras linhas é a mesma que separa A3 (interesse) de
A3 (pós-venda), e a mesma que, em Concessão, separa abrir processo de
**acompanhar** processo existente.

## B3. Não bloquear por ausência de categoria

**REQUISITO CONVERSACIONAL**

A falta de uma categoria específica **não bloqueia** o atendimento (A11). O
atendimento segue pelo assunto-base, com a reclamação anexada.

---

# C) GAP / REQUISITO TÉCNICO FUTURO

```
DOMAIN_MODEL_GAP / DECIDED_KNOWLEDGE_AWAITING_FUTURE_IMPLEMENTATION
```

**O conhecimento humano está decidido.** O gap é do modelo técnico atual.

## C1. Categoria operacional `RECLAMAÇÃO` na solicitação

A8 determina que a reclamação gere **uma solicitação normal**, **categorizada
como `RECLAMAÇÃO`**.

O domínio representa a reclamação como **overlay de goal**, e
`GOAL_RECLAMACAO` tem **`creates_case: false`** — quem cria o case é o
**goal-base**. Não existe, no domínio, **campo de categoria** sobre a solicitação
que a marque como reclamação.

```
OVERLAY DE GOAL   !=   CATEGORIA NA SOLICITACAO
```

São duas coisas diferentes, e A8 pede a segunda. O desenho de persistência em
`santana-conversation-domain/persistence-design-review.md` já prevê uma tabela
`service_requests` com "guard anti-gravidade em `RECLAMACAO`" — o que indica que
a categoria foi **antecipada no desenho**, mas ela **não existe no domínio
versionado** como fato, enum ou campo.

**Não criei o campo.** Fica registrado o gap e a pergunta que ele carrega: se a
categoria é derivada da presença do overlay ou se é um dado próprio da
solicitação. **Não escolhi entre as duas.**

## C2. Estado de pós-venda / acompanhamento

A3, A6 e B2 dependem de distinguir **abrir uma venda** de **acompanhar algo já
comprado**.

O domínio chega perto e **não fecha**: `commercial_stage` distingue `ORCAMENTO`
de `PEDIDO_PAGO`/`PEDIDO_NAO_PAGO`, e `commercial_delivery_status` distingue
`PENDENTE` de `INSTALADO`. Isso permite **reconhecer** o caso de A3
(pago + pendente = pós-venda).

O que **não existe** é o estado do **acompanhamento em si**:

| Estado pressuposto | Onde é exigido | Representação hoje |
| --- | --- | --- |
| solicitação de acompanhamento aberta | A3, A5, A6 | **não existe** |
| solicitação de contato comercial aberta | A2 | **não existe** |
| solicitação de orçamento aberta | A4, A6 | **não existe** |
| retorno/andamento do setor | A3, A5 | **não existe** |

> **Isto é descrição do gap.** Não é enum, não é schema, não é código, e **não
> deve ser transformado em nenhum dos três nesta tarefa**.

Este é o **mesmo gap** já registrado em `C1` da decisão de Processo de
Concessão — estado de solicitação e acompanhamento não representados —,
manifestando-se em outro tópico. **Não os unifiquei**: são o mesmo problema
técnico visto de dois tópicos, e a decisão de como representá-lo é uma só, mas
não é minha.

## C3. Destinatário do encaminhamento não existe

A2 fala em **setor/representante comercial**; A5 fala em **setor
responsável/comercial**. O domínio conhece quatro ações de encaminhamento —
`ACTION_VERIFY_GRAVE_SITUATION`, `ACTION_COLLECT_GRAVE_AUTHORIZATION`,
`ACTION_COLLECT_EXHUMATION_AUTHORIZATION`, `ACTION_VERIFY_RECADASTRO` — e todas
apontam genericamente para a **Administração**.

Não existe representação do setor comercial como destinatário. É o **mesmo gap**
de `C2` da decisão de Concessão, com outro destinatário. **Não criei nem a ação
nem a entidade.**

## C4. Itens de A4 e A5 fora do enum `commercial_item`

`commercial_item` aceita hoje cinco valores: `LAPIDE`, `JAZIGO`, `OSSUARIO`,
`CINZAS`, `ZELADORIA`.

| Item da decisão | Situação |
| --- | --- |
| **portão / tranca** (A4) | não existe. A decisão diz que **pertencem a Zeladoria** — o que sugere subtipo dentro de `ZELADORIA`, e não valor novo no mesmo enum. **Não presumi qual dos dois.** |
| **reforma / construção** (A5) | **não existe em nenhuma forma** — nem valor, nem capacidade, nem subtipo |

**Não alterei o enum.** Registro também que A1 declara o Comercial
deliberadamente básico: parte disto pode ser exatamente o que o enriquecimento
futuro cobre, e não uma lacuna a fechar agora.

## C5. Intenção invisível não é um atributo declarado

A7 decide que a reclamação é **intenção invisível**: reconhecida por linguagem,
sem precisar de opção de menu.

O domínio implementa o **efeito** — `RECLAMACOES` é `layer: OVERLAY`, e
`topics.v1.json` declara que serviços, produtos e subtipos não são tópicos
principais —, e o interpretador tem entradas de léxico que disparam `COMPLAINT`.
Mas **"intenção invisível" não é um atributo declarado** de tópico ou goal: é uma
propriedade que hoje emerge da combinação overlay + léxico.

Isso funciona. Fica registrado apenas porque **A7 é uma decisão sobre
apresentação ao munícipe**, e o que existe hoje é uma decisão sobre estrutura de
goals — as duas coincidem no resultado, mas nada garante que continuem
coincidindo se a estrutura mudar.

## C6. Valores de lápide e plano de zeladoria não estão versionados aqui

A3 e A4 mandam **preservar valores e condições já consolidados**. Verifiquei por
varredura de `docs/`, `santana-conversation-domain/`, `santana-authority/` e
`santana-authority-gateway/`: **não há valor de lápide nem plano de zeladoria
versionado neste repositório**. O catálogo autoritativo publica hoje apenas
`R$ 106,57`, `R$ 351,67` e `R$ 586,04`, todos de exumação.

**Isto não os invalida** — são consolidados na operação, fora deste repositório.
É a mesma situação já registrada em `C4` da decisão de Processo de Concessão, e
registro pelo mesmo motivo: para que quem implementar **não procure a fonte
versionada e conclua que ela foi perdida**, e para que a publicação passe pelo
rito das demais — fonte, aplicabilidade e vigência declaradas.

Consequência prática de A6 enquanto isso não é publicado: sem fonte oficial
carregada, o Gateway responde `NOT_AVAILABLE` — que é exatamente o
comportamento que a terceira regra de A6 pede ("não inventar valor").

---

# Auditoria de contradições

Varredura sobre `docs/`, `santana-conversation-domain/`, `santana-authority/` e
`santana-authority-gateway/`.

| Ponto auditado | Resultado |
| --- | --- |
| classificação automática de gravidade em reclamação | **nenhuma contradição — concordância em quatro lugares.** `topics.v1.json`, `relations.v1.json`, `conversation-events.v1.json` e o invariante `I12` do desenho de persistência já a proíbem |
| reclamação substituindo o assunto-base | **nenhuma contradição — concordância.** `replaces_base_goal: false`, `base_goal_remains_active: true`, e `replace_base_goal` está em `forbidden` no evento `COMPLAINT` |
| setor exclusivo de reclamações | **nenhuma contradição.** `RECLAMACOES` é `layer: OVERLAY`, e não um setor ou fluxo próprio |
| exigir que o munícipe declare a reclamação | **nenhuma contradição.** A fixture `M08` já espera `COMPLAINT` a partir de linguagem espontânea, sem menção a "reclamar" |
| robô fechando venda | **nenhuma contradição.** Nenhum documento atribui fechamento de venda ao robô |
| valor inventado para serviço sem preço | **nenhuma contradição — concordância.** `docs/blueprint-binding.md` já registra que `A_CONFIRMAR` não pode resolver preço, prazo, SLA ou documento obrigatório |
| pós-venda tratado como nova venda | **nenhuma contradição.** `commercial_delivery_status` já existe precisamente para distinguir pedido pago de item instalado |

**Nenhuma contradição encontrada. Nenhum conflito material exigindo nova decisão
humana.**

Registro um **ponto de atenção que não é contradição**: A8 pede solicitação
**categorizada** como `RECLAMAÇÃO`, e o domínio modela a reclamação como
**overlay de goal** com `creates_case: false`. Não é conflito — o case vem do
goal-base, e o overlay se anexa a ele —, mas **categoria e overlay não são a
mesma coisa**, e a categoria não existe. Tratado em `C1`, **não resolvido
silenciosamente**.

---

# O que estas decisões NÃO autorizam

- Não autorizam alterar `commercial_item`, `commercial_stage` ou
  `commercial_delivery_status`.
- Não autorizam criar campo, enum ou schema de categoria de solicitação (`C1`).
- Não autorizam criar entidade ou ação para o setor comercial (`C3`).
- Não autorizam acrescentar portão/tranca ou reforma/construção ao enum (`C4`).
- Não autorizam o robô a fechar venda.
- Não autorizam estimar, arredondar ou inferir valor de serviço sem preço fixo
  consolidado.
- Não autorizam classificar gravidade de reclamação, por nenhum meio.
- Não autorizam substituir o assunto-base pela reclamação.
- Não autorizam bloquear atendimento por ausência de categoria.
- Não autorizam tratar o escopo básico do Comercial (`A1`) como lacuna a fechar
  sem decisão — o enriquecimento é permitido, não exigido.
- Não autorizam reescrever os vetores congelados da Fase 2.
- Não autorizam iniciar a Fase 4.

---

# Fontes canônicas

| | |
| --- | --- |
| Tópicos, goals, relações, fatos e perguntas | `santana-conversation-domain/topics.v1.json`, `goals.v1.json`, `relations.v1.json`, `facts.v1.json`, `questions.v1.json` |
| Evento `COMPLAINT` | `santana-conversation-domain/conversation-events.v1.json` |
| Fixture `M08` | `santana-conversation-domain/runtime/fixtures/messages.v1.json` |
| Desenho de persistência e invariante `I12` | `santana-conversation-domain/persistence-design-review.md` |
| Catálogo oficial | `santana-authority/catalogo/exumacao.v1.json` |
| Decisões humanas anteriores | `docs/decisoes-humanas/` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Estado operacional do projeto | `docs/HANDOFF-PROJETO-SANTANA.md` |
