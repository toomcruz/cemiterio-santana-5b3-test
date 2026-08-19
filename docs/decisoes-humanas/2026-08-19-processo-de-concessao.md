# Decisão humana — PROCESSO DE CONCESSÃO

```
DATA          2026-08-19
DECISOR       mantenedor do projeto
ESCOPO        PROCESSO DE CONCESSAO: responsabilidade pelo processo, iniciativa
              da familia, pre-requisito de Recadastro, taxa inicial, dados da
              solicitacao, pagamento, os tres documentos, interpretacao dos
              termos, documentacao incompleta, assinaturas, prazo,
              acompanhamento de processo existente e fronteira de autoridade
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
```

Este documento **registra** decisões. Ele **não** altera runtime, catálogo
autoritativo, domínio, schemas, contratos, enums, vetores, referência Python,
Gateway TS/Deno, workflows, Supabase nem n8n. Nada aqui está em vigor até ser
publicado no catálogo oficial e validado pelos vetores.

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

O tópico de Concessão **já existe** e foi preservado integralmente:

| Já existente | Onde |
| --- | --- |
| Tópico `CONCESSAO` — "Processo de Concessao", capacidades `CONCESSAO_NOVA`, `TRANSFERENCIA_CONCESSAO`, `RENOVACAO_CONCESSAO` | `santana-conversation-domain/topics.v1.json` |
| `GOAL_CONCESSAO`, `creates_case: true`, sujeito `CONCESSION`, `required_facts` = `concession_purpose`, `recadastro_status`, `concession_reference`, `requester_document` | `santana-conversation-domain/goals.v1.json` |
| `REL_CONCESSAO_REQUIRES_RECADASTRO` — Recadastro é **pré-requisito obrigatório**; `recadastro_status = PENDENTE` empilha `GOAL_RECADASTRO` e retorna ao pai | `santana-conversation-domain/relations.v1.json` |
| `REL_CONCESSAO_RECADASTRO_UNKNOWN` — `DESCONHECIDO` aciona `ACTION_VERIFY_RECADASTRO`; **não presumir `OK` nem `PENDENTE`** | `santana-conversation-domain/relations.v1.json` |
| `concession_purpose` = `NOVA` / `TRANSFERENCIA` / `RENOVACAO`; `concession_reference`; `recadastro_status` com `blocking_values: [DESCONHECIDO]` | `santana-conversation-domain/facts.v1.json` |
| Perguntas de recadastro, identificação da concessão, documento do titular e finalidade | `santana-conversation-domain/questions.v1.json` |

Decisões relacionadas, dos mesmos dias:
`2026-08-19-exumacao-tarifa-vigencia.md`, `2026-08-19-exumacao-procedimento.md`,
`2026-08-19-recadastro-sucessao-administracao-provisoria.md`,
`2026-08-19-transporte-falecidos-e-restos-mortais.md`.

---

# A) DECISÕES HUMANAS APROVADAS

## A1. Responsabilidade pelo processo

**DECISÃO HUMANA APROVADA**

Existe um **Setor de Concessões próprio**.

O atendimento/robô do Cemitério Santana atua como **apoio inicial** e pode:

- identificar a intenção;
- verificar o pré-requisito de Recadastro;
- fornecer orientações já autorizadas;
- coletar os dados necessários;
- abrir a solicitação necessária para cobrança da taxa inicial;
- disponibilizar os termos;
- orientar contato/acompanhamento com o Setor de Concessões.

**O robô NÃO conduz a análise administrativa da Concessão.**

## A2. A família inicia o processo

**DECISÃO HUMANA APROVADA**

O Processo de Concessão é **iniciado por decisão da família**.

O robô **NÃO** deve:

- decidir pela família se deve iniciar;
- escolher quem deve assumir a concessão;
- determinar quem possui direito;
- escolher sucessor;
- arbitrar conflitos familiares;
- emitir parecer sucessório.

A **família** toma as decisões familiares necessárias. O **Setor de Concessões**
conduz as particularidades administrativas.

## A3. Pré-requisito — Recadastro

**DECISÃO HUMANA APROVADA** — preserva regra já consolidada.

O Processo de Concessão **exige que o jazigo esteja recadastrado**.

| Situação | Comportamento |
| --- | --- |
| Recadastro **já confirmado** | **reutilizar** essa informação |
| **Não** recadastrado | orientar **primeiro** o Recadastro |
| Munícipe **não sabe** | **verificar** a situação cadastral; **NÃO** mandar realizar novo Recadastro às cegas |

As relações já existentes entre Concessão e Recadastro no domínio ficam
**preservadas**: `REL_CONCESSAO_REQUIRES_RECADASTRO` e
`REL_CONCESSAO_RECADASTRO_UNKNOWN`. A terceira linha da tabela é exatamente o que
`REL_CONCESSAO_RECADASTRO_UNKNOWN` já implementa, e é a mesma regra registrada em
`A10` da decisão de Recadastro do mesmo dia.

## A4. Taxa inicial

**DECISÃO HUMANA APROVADA** — nova/reforçada.

| Item | Valor |
| --- | --- |
| Taxa inicial do Processo de Concessão | **R$ 94,00** |

A família deve providenciar essa taxa **o quanto antes**.

**Não é necessário esperar** toda a documentação da Concessão ficar completa para
iniciar essa etapa de cobrança.

```
DOCUMENTACAO INCOMPLETA
        !=
IMPEDIMENTO AUTOMATICO PARA COBRANCA DA TAXA INICIAL
```

A taxa **não** deve ser documentada como dependente de checklist documental
completo. Nenhuma decisão humana anterior afirma o contrário — ver a auditoria
de contradições ao final, ponto 1.

## A5. Dados para a solicitação

**DECISÃO HUMANA APROVADA** — preserva o que já está consolidado.

Preservar os dados já consolidados para identificação do processo e geração da
solicitação de cobrança, incluindo:

- nome do concessionário;
- localização do jazigo;
- rua / terreno / quadra quando aplicável;
- demais dados já previstos no procedimento existente.

A cobrança é realizada **pelo Setor de Concessões**, conforme o fluxo já
consolidado.

**Não inventar novos campos obrigatórios.**

## A6. Pagamento

**DECISÃO HUMANA APROVADA** — preserva as formas já consolidadas.

- **Pix**;
- **cartão**, conforme procedimento aplicável.

**Não inventar parcelamentos, descontos ou novas condições.**

## A7. Os três documentos

**DECISÃO HUMANA APROVADA** — preserva os três documentos já consolidados.

1. **Requerimento**
2. **Termo de Desistência**
3. **Termo de Desistência/Casado**

Quando o atendimento exigir o envio desse conjunto, **os três devem ser
disponibilizados juntos**.

**Não remover, renomear ou reinterpretar os documentos.**

## A8. Interpretação dos termos

**DECISÃO HUMANA APROVADA**

O robô **NÃO** deve realizar análise sucessória para decidir sozinho:

- quem precisa desistir;
- qual familiar deve assinar determinado termo;
- quem possui direito à concessão;
- como resolver determinada composição familiar;
- qual resultado sucessório deve decorrer da documentação.

Quando a resposta depender de **situação familiar, sucessória ou de
interpretação administrativa**:

```
-> CONSULTAR / ORIENTAR CONTATO COM O SETOR DE CONCESSOES
```

O robô **pode** disponibilizar os documentos e fornecer orientações já
explicitamente aprovadas, mas **não substitui a análise do Setor**.

## A9. Documentação incompleta

**DECISÃO HUMANA APROVADA**

Não é necessário que toda a documentação esteja completa para a família
providenciar a taxa inicial de **R$ 94,00**.

Fluxo conceitual:

```
FAMILIA DECIDE INICIAR
        |
RECADASTRO ATENDIDO
        |
COBRANCA DA TAXA DE R$ 94,00 O QUANTO ANTES
        |
DOCUMENTACAO PODE CONTINUAR SENDO ORGANIZADA
        |
SETOR DE CONCESSOES CONDUZ PARTICULARIDADES
```

**NÃO afirmar:** *"Só é possível iniciar quando todos os documentos estiverem
completos."*

## A10. Assinaturas

**DECISÃO HUMANA APROVADA** — preserva as modalidades já consolidadas.

- **GOV.BR**;
- **firma reconhecida**;

conforme o procedimento aplicável.

Quando a dúvida for sobre **qual familiar precisa assinar qual termo**, e isso
depender da situação sucessória:

- **não decidir automaticamente**;
- **encaminhar/orientar** consulta ao Setor de Concessões.

## A11. Prazo

**DECISÃO HUMANA APROVADA** — preserva o prazo informativo consolidado.

```
ATE 180 DIAS
```

O robô **pode informar** esse prazo como **referência** do Processo de Concessão.

```
ATE 180 DIAS  !=  DATA DE CONCLUSAO GARANTIDA
```

**Não prometer uma data específica.**

## A12. Acompanhamento de processo existente

**DECISÃO HUMANA APROVADA**

Se a família **já iniciou** a Concessão e pergunta sobre demora, andamento ou
retorno:

- **NÃO abrir automaticamente** um novo Processo de Concessão;
- tratar como **acompanhamento de processo existente**;
- orientar acompanhamento com o Setor de Concessões, pelos canais já
  consolidados.

## A13. Fronteira de autoridade

**DECISÃO HUMANA APROVADA**

| ROBÔ DO SANTANA **PODE** | ROBÔ DO SANTANA **NÃO PODE** |
| --- | --- |
| reconhecer a intenção | escolher sucessor |
| explicar o processo no nível autorizado | determinar titular |
| verificar Recadastro | decidir quem tem direito à concessão |
| reutilizar informações já conhecidas | arbitrar conflito familiar |
| coletar dados necessários | emitir parecer sucessório |
| abrir a solicitação para cobrança | decidir quais familiares precisam desistir |
| informar R$ 94,00 | substituir o Setor de Concessões |
| disponibilizar os três documentos | |
| informar prazo | |
| orientar contato/acompanhamento | |

Esta é a mesma fronteira que governa todo o projeto, aplicada ao tópico:

```
O LLM NAO pode ser autoridade administrativa.
```

## A14. Separação de responsabilidades

**DECISÃO HUMANA APROVADA**

```
FAMILIA
  -> decide iniciar
  -> toma decisoes familiares

ROBO / ATENDIMENTO SANTANA
  -> triagem
  -> orientacao autorizada
  -> verificacao de pre-requisito
  -> coleta
  -> solicitacao de cobranca
  -> envio de documentos
  -> encaminhamento

SETOR DE CONCESSOES
  -> analise administrativa
  -> particularidades familiares/documentais
  -> orientacao especifica
  -> conducao do Processo de Concessao
```

---

# B) REQUISITOS CONVERSACIONAIS

Comportamento de atendimento. **Nada aqui é regra jurídica ou administrativa**, e
nada aqui pode ser convertido em regra administrativa sem decisão humana
específica.

## B1. Inteligência conversacional

**REQUISITO CONVERSACIONAL**

| Situação | Comportamento |
| --- | --- |
| informação **já conhecida** | reutilizar |
| informação **faltante e necessária** | perguntar |
| dúvida que exige **análise do Setor** | não inventar; encaminhar ao Setor de Concessões |
| **processo já iniciado** | não abrir outro automaticamente |
| **mudança de assunto** | preservar o estado do processo |
| **retorno posterior** | retomar do estado conhecido, quando disponível |

## B2. O fluxo não é questionário

**REQUISITO CONVERSACIONAL**

O fluxo **não deve ser implementado futuramente como questionário rígido**. As
perguntas existem para preencher o que falta, e não para percorrer uma lista.

Isto conversa com o contrato **R6** (uma pergunta pendente por turno, com
precedência `DESAMBIGUACAO_GATEWAY > PROXIMA_PERGUNTA_DO_DOMINIO`) e **não**
conflita com ele: R6 limita quantas perguntas cabem num turno; B2 diz que a
sequência não é fixa.

---

# C) GAP / REQUISITO TÉCNICO FUTURO

```
DOMAIN_MODEL_GAP / DECIDED_KNOWLEDGE_AWAITING_FUTURE_IMPLEMENTATION
```

**O conhecimento humano está decidido.** O gap é do modelo técnico atual.

## C1. Estado do processo não é representado

O domínio representa hoje, para Concessão, apenas **finalidade**
(`concession_purpose` = `NOVA` / `TRANSFERENCIA` / `RENOVACAO`), **identificação**
(`concession_reference`), o **pré-requisito** (`recadastro_status`) e o
**solicitante** (`requester_document`).

Nenhum dos estados que as decisões acima pressupõem existe:

| Estado pressuposto | Onde é exigido | Representação hoje |
| --- | --- | --- |
| processo iniciado | A2, A12, B1 | **não existe** |
| taxa solicitada | A1, A4, A9 | **não existe** |
| taxa paga | A6, A9 | **não existe** |
| documentação pendente | A9 | **não existe** |
| documentação em análise | A8, A9 | **não existe** |
| acompanhamento | A12 | **não existe** |
| encaminhamento ao Setor | A1, A8, A10, A12 | **não existe** |

> **Isto é descrição do gap.** Não é enum, não é schema, não é código, e **não
> deve ser transformado em nenhum dos três nesta tarefa**. Os nomes acima
> descrevem o estado, não são identificadores propostos.

O mais estrutural é **"processo iniciado"**: A12 proíbe abrir um novo processo
quando já existe um, e B1 repete a proibição. Sem representação de processo
existente, a proibição **não é verificável** — `GOAL_CONCESSAO` tem
`creates_case: true` e, hoje, nada o impede de criar outro case.

Vale notar que **taxa solicitada** e **taxa paga** são eixos distintos, e A9 os
separa deliberadamente: a cobrança é aberta cedo, e a documentação continua sendo
organizada em paralelo. Colapsá-los num único status perderia exatamente a
decisão de A9.

## C2. "Setor de Concessões" não existe como destinatário

O domínio conhece quatro ações de encaminhamento — `ACTION_VERIFY_GRAVE_SITUATION`,
`ACTION_COLLECT_GRAVE_AUTHORIZATION`, `ACTION_COLLECT_EXHUMATION_AUTHORIZATION` e
`ACTION_VERIFY_RECADASTRO` — e todas apontam genericamente para a
**Administração**.

**Não existe** representação do **Setor de Concessões** como destinatário
distinto, nem ação de encaminhamento a ele. A1, A8, A10 e A12 dependem desse
encaminhamento em quatro momentos diferentes.

Fica registrado como gap. **Não criei a ação nem a entidade.**

## C3. R$ 94,00 — mesmo numeral, dois componentes distintos

```
ATENCAO - COLISAO DE VALOR, NAO IDENTIDADE DE COMPONENTE
```

O valor **R$ 94,00** já foi registrado neste repositório, na decisão de
TRANSPORTE do mesmo dia (`C3` daquele documento), como componente **"abertura /
movimentação em jazigo"**, cobrado quando **não** há nova Exumação.

Agora **A4** registra **R$ 94,00** como **taxa inicial do Processo de Concessão**.

| Documento | Componente | Quando incide |
| --- | --- | --- |
| Transporte, A13/A16/A17.2 | abertura / movimentação em jazigo | movimentação de restos ou cinzas, sem nova Exumação |
| Concessão, A4 | taxa inicial do Processo de Concessão | início do processo, antes da documentação completa |

**Não presumi que sejam o mesmo componente.** São dois fatos administrativos
diferentes, em tópicos diferentes, com fatos geradores diferentes, que hoje têm o
mesmo valor. Publicá-los como **uma única entrada** de catálogo faria com que uma
futura alteração de um alterasse silenciosamente o outro — que é precisamente a
classe de erro que a separação por componente existe para impedir.

Também **não afirmei o contrário**: nada nas decisões diz que os dois componentes
são independentes por natureza. A escolha é **decisão humana**, e não a tomei.

**R$ 94,00 continua não existindo no catálogo autoritativo**, que publica hoje
apenas `R$ 106,57`, `R$ 351,67` e `R$ 586,04`. Publicá-lo — em uma entrada ou em
duas — altera o `release_id`, com a consequência já registrada nas decisões
anteriores: os vetores do release anterior passam a `INVALIDO`, o que é esperado
e **não** é `FAIL`, e **os vetores congelados da Fase 2 não são reescritos
agora**.

## C4. Itens "já consolidados" que não existem versionados neste repositório

As decisões A5, A6, A7, A10 e A11 mandam **preservar** procedimentos já
consolidados. Verifiquei por varredura de `docs/`,
`santana-conversation-domain/`, `santana-authority/` e
`santana-authority-gateway/`: os itens abaixo **não aparecem em nenhum arquivo
versionado deste repositório**.

| Item | Decisão | Situação neste repositório |
| --- | --- | --- |
| Setor de Concessões | A1 | não existe |
| taxa inicial de R$ 94,00 | A4 | não existe |
| nome do concessionário, rua / terreno / quadra como dados da solicitação | A5 | não existem como fatos; `concession_reference` é `TEXT` livre |
| Pix e cartão | A6 | não existem |
| Requerimento, Termo de Desistência, Termo de Desistência/Casado | A7 | não existem |
| firma reconhecida | A10 | não existe |
| prazo de até 180 dias | A11 | não existe |
| canais de acompanhamento | A12 | não existem |

**Isto não os invalida.** "Consolidado" aqui significa consolidado na operação e
na revisão funcional humana — fora deste repositório. Registro a diferença para
que quem implementar **não procure a fonte versionada e conclua erradamente que
ela foi perdida**, e para que a publicação de cada um passe pelo mesmo rito das
demais: fonte, aplicabilidade e vigência declaradas.

Uma exceção parcial: **GOV.BR** (A10) **existe** versionado, em `A8` da decisão de
Recadastro — mas ali para a **troca de Administrador Provisório**, não para os
termos da Concessão. São aplicações diferentes da mesma modalidade de assinatura.
**Preservei as duas, sem fundi-las.**

---

# Auditoria de contradições

Varredura sobre `docs/`, `santana-conversation-domain/`, `santana-authority/` e
`santana-authority-gateway/`, buscando documentação anterior que afirmasse ou
implicasse cada ponto.

| # | Ponto auditado | Resultado |
| --- | --- | --- |
| 1 | documentação completa obrigatória antes dos R$ 94,00 | **nenhuma contradição.** Nenhum documento condiciona cobrança a checklist documental completo. O item 17 da decisão de procedimento de Exumação exige conjunto completo para **abrir solicitação de agendamento** — que é outro ato, em outro tópico; ver ponto de atenção abaixo |
| 2 | robô escolhendo sucessor/titular | **nenhuma contradição — há concordância.** A decisão de Recadastro registra a linha sucessória como **regra a aplicar**, e não como juízo do robô; e o Gateway já é, por construção, proibido de escolher (`required_authorization_signatory` é fato derivado de fato confirmado) |
| 3 | robô interpretando automaticamente quem deve assinar termos | **nenhuma contradição.** Nenhum documento atribui essa interpretação ao robô. As assinaturas de exumação são derivadas de `surviving_spouse_status`, um fato **confirmado**, e não de análise sucessória livre |
| 4 | cobrança dos R$ 94,00 somente após análise documental completa | **nenhuma contradição.** Nenhuma menção a R$ 94,00 em Concessão antes desta revisão |
| 5 | 180 dias como garantia rígida de conclusão | **nenhuma contradição.** "180" não aparece em nenhum documento de decisão; a única ocorrência no repositório é `180 s` de timeout de worker em `docs/legacy-new-mapping.md`, sem relação com o tema |
| 6 | atendimento do Santana como autoridade final da Concessão | **nenhuma contradição — há concordância.** O item 14 da decisão de Exumação já diz que "Santana cuida apenas do que compete ao Santana", e `REL_CONCESSAO_RECADASTRO_UNKNOWN` já encaminha à Administração em vez de presumir |

## Pontos de atenção que **não** são contradições

**1. Solicitação de agendamento × solicitação de cobrança.** O item 17 da decisão
de procedimento de Exumação determina que o robô só abra solicitação quando "todo
o conjunto necessário estiver completo". A4 e A9 determinam o oposto para a taxa
inicial de Concessão: abrir cedo, sem esperar documentação.

**Não é conflito**: são dois atos diferentes, em dois tópicos diferentes. Um é
**solicitação de agendamento** de um serviço físico com data e horário; o outro é
**solicitação de cobrança** de uma taxa inicial. Não alterei nem o item 17 nem
A4/A9. Registro para que a implementação não generalize a regra do item 17 para
toda e qualquer "solicitação".

**2. Colisão de valor em R$ 94,00.** Tratada em `C3`. Não é contradição — é o
mesmo numeral em dois componentes distintos —, e **não foi resolvida
silenciosamente**.

**Nenhum conflito material exigindo nova decisão humana foi encontrado.**

---

# O que estas decisões NÃO autorizam

- Não autorizam alterar `santana-authority/catalogo/exumacao.v1.json`.
- Não autorizam criar enum, schema, fato ou ação para os estados de `C1`.
- Não autorizam criar entidade ou ação para o Setor de Concessões (`C2`).
- Não autorizam publicar R$ 94,00 como **uma** entrada compartilhada entre
  Concessão e Transporte — nem como duas — sem decisão explícita (`C3`).
- Não autorizam o robô a decidir quem assina, quem desiste ou quem tem direito.
- Não autorizam prometer data de conclusão.
- Não autorizam abrir novo Processo de Concessão quando já existe um.
- Não autorizam inventar campos obrigatórios, parcelamentos, descontos ou
  condições de pagamento.
- Não autorizam remover, renomear ou reinterpretar os três documentos.
- Não autorizam reescrever os vetores congelados da Fase 2.
- Não autorizam iniciar a Fase 4.

---

# Fontes canônicas

| | |
| --- | --- |
| Catálogo oficial | `santana-authority/catalogo/exumacao.v1.json` |
| Tópico, goal, relações e fatos de Concessão | `santana-conversation-domain/topics.v1.json`, `goals.v1.json`, `relations.v1.json`, `facts.v1.json` |
| Decisão de tarifa e vigência | `docs/decisoes-humanas/2026-08-19-exumacao-tarifa-vigencia.md` |
| Decisão de procedimento de Exumação | `docs/decisoes-humanas/2026-08-19-exumacao-procedimento.md` |
| Decisão de Recadastro | `docs/decisoes-humanas/2026-08-19-recadastro-sucessao-administracao-provisoria.md` |
| Decisão de Transporte | `docs/decisoes-humanas/2026-08-19-transporte-falecidos-e-restos-mortais.md` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Significado de `INVALIDO` | `conformidade/vetores/FORMATO.md` |
| Estado operacional do projeto | `docs/HANDOFF-PROJETO-SANTANA.md` |
