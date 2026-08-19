# Decisão humana — TRANSPORTE DE FALECIDOS E RESTOS MORTAIS

```
DATA          2026-08-19
DECISOR       mantenedor do projeto
ESCOPO        transporte e movimentacao de restos mortais, ossos, despojos ja
              exumados e cinzas: origem, situacao atual, destino, ossuario
              alugado e perpetuo, jazigo, cremacao, outro cemiterio, entrada de
              restos externos, documentacao, valores e solicitacao de
              agendamento
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
```

Este documento **registra** decisões. Ele **não** altera runtime, catálogo
autoritativo, schemas, contratos, enums, vetores, referência Python, Gateway
TS/Deno, workflows, Supabase nem n8n. Nada aqui está em vigor até ser publicado
no catálogo oficial e validado pelos vetores.

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

O domínio de Transporte **já existe** e foi preservado. Não recriei nada dele:

| Já existente | Onde |
| --- | --- |
| Tópico `TRANSPORTE` — "Transporte de Falecidos e Restos Mortais" | `santana-conversation-domain/topics.v1.json` |
| `GOAL_TRANSPORTE` e seus `required_facts` | `santana-conversation-domain/goals.v1.json` |
| `REL_TRANSPORTE_REQUIRES_EXUMACAO` — restos `SEPULTADO` tornam a Exumação dependência | `santana-conversation-domain/relations.v1.json` |
| `REL_TRANSPORTE_ALREADY_EXHUMED` — restos `EXUMADO` satisfazem a dependência **neste caso** | `santana-conversation-domain/relations.v1.json` |
| `REL_TRANSPORTE_JAZIGO_FAMILIA_CHECK` — destino em jazigo exige referência, situação e autorização **dentro do mesmo goal** | `santana-conversation-domain/relations.v1.json` |
| `EXU_RESTOS_JA_EXUMADOS`, `EXU_JAZIGO_DESTINO`, `EXU_OSSUARIO` | `santana-authority/catalogo/exumacao.v1.json` |

Decisões relacionadas, do mesmo dia:
`2026-08-19-exumacao-tarifa-vigencia.md`, `2026-08-19-exumacao-procedimento.md`,
`2026-08-19-recadastro-sucessao-administracao-provisoria.md`.

O item 15 da decisão de procedimento de Exumação remete o transporte a este
tópico e proíbe duplicar as regras dentro de Exumação. Este documento é o
destino daquela remissão.

---

# A) DECISÕES HUMANAS APROVADAS

## A1. Escopo do tópico

**DECISÃO HUMANA APROVADA**

O tópico cobre:

- restos mortais e ossos;
- despojos **já exumados**;
- cinzas;
- retirada ou desativação de ossuário;
- movimentações internas dentro do Santana;
- saída para outro cemitério;
- **entrada** de restos vindos de outro cemitério;
- encaminhamento para cremação.

O atendimento precisa distinguir **três eixos**, sempre:

```
ORIGEM            de onde os restos vem
SITUACAO ATUAL    sepultado, ja exumado, em ossuario, cinzas
DESTINO           para onde vao
```

**Não classificar automaticamente como Transporte** só porque o munícipe disse
"tirar", "levar" ou "transferir". Se os restos **ainda estão sepultados** e é
necessária a retirada física, o caso **pode ser Exumação**.

## A2. Ossuário alugado — prazo

**DECISÃO HUMANA APROVADA**

- Contrato de **5 anos**.
- Após o vencimento, há **1 mês** para renovar.
- Não havendo renovação, o ossuário **poderá ser desativado**.
- **NÃO afirmar** que a desativação ou a movimentação ocorre **automaticamente,
  exatamente após 1 mês**.
- Se já houver sido desativado, a **situação atual precisa ser verificada**.

> Esta formulação **prevalece sobre qualquer interpretação anterior** de
> desativação automática após o prazo. Ver a seção **Correção de A2** ao final,
> que preserva o texto anterior sem apagá-lo.

## A3. Pendências

**DECISÃO HUMANA APROVADA**

```
PENDENCIA  ->  REGULARIZACAO  ->  MOVIMENTACAO
```

A movimentação vem **depois** da regularização, e a regularização vem depois de
identificada a pendência.

## A4. Taxa de desativação de ossuário

**DECISÃO HUMANA APROVADA**

| Item | Valor |
| --- | --- |
| Desativação / retirada de ossuário | **R$ 106,57** |

Aplica-se **tanto ao ossuário alugado quanto ao perpétuo (adquirido)**. Não é
taxa exclusiva do alugado.

## A5. Ossuário → Jazigo de Família

**DECISÃO HUMANA APROVADA**

- Cobra-se **somente R$ 106,57**.
- **NÃO acrescentar R$ 94,00.**
- É necessário **identificar e verificar o jazigo** de destino.
- É necessária a **autorização** cabível.

## A6. Ossuário → Cremação

**DECISÃO HUMANA APROVADA**

- **R$ 106,57** de desativação.
- **Não há nova Exumação.**
- **Nenhuma outra taxa do Santana.**

## A7. Ossuário → Outro cemitério

**DECISÃO HUMANA APROVADA**

- **R$ 106,57**.
- **Nenhuma outra taxa do Santana.**
- Em seguida, aplica-se a **documentação de transporte** (A18).

## A8. Ossuário alugado → Ossuário perpétuo

**DECISÃO HUMANA APROVADA**

- **R$ 106,57** + **valor vigente da aquisição** do ossuário perpétuo.
- O ossuário alugado **NÃO é convertido** em perpétuo.
- **Outro ossuário é adquirido.**
- Os restos são transferidos para o **Bloco I**.

## A9. Ossuário perpétuo — natureza

**DECISÃO HUMANA APROVADA**

- É **adquirido**.
- É **individual**: **1 falecido**.
- **Sem renovação de 5 anos.**
- **Sem débito de renovação.**
- Retirada: **R$ 106,57**.

**Não transportar para o perpétuo as regras de atraso e vencimento do ossuário
alugado.**

## A10. Restos vindos de outro cemitério

**DECISÃO HUMANA APROVADA**

Restos mortais vindos de outro cemitério **podem entrar** no Santana, com
destino a:

- ossuário alugado;
- ossuário perpétuo;
- Jazigo de Família.

**Não existe regra** que limite os ossuários do Santana a exumações feitas no
Santana.

## A11. Outro cemitério → Ossuário alugado

**DECISÃO HUMANA APROVADA**

- Cobra-se **somente o valor do ossuário alugado**.
- **Sem acréscimo de entrada** e **sem acréscimo de reinumação**.
- O **contrato de 5 anos** do ossuário alugado é preservado.

## A12. Outro cemitério → Ossuário perpétuo

**DECISÃO HUMANA APROVADA**

- Cobra-se **somente o valor da aquisição**.
- **Sem acréscimo.**

## A13. Outro cemitério → Jazigo de Família

**DECISÃO HUMANA APROVADA**

- **R$ 94,00**.
- **Identificar o jazigo.**
- **Verificar situação e regularidade** do jazigo.
- **Autorização** do concessionário **ou** do Administrador Provisório.
- Aplica-se a **documentação de transporte**.

## A14. Cinzas — destinos

**DECISÃO HUMANA APROVADA**

Cinzas podem ir para:

- ossuário alugado;
- ossuário perpétuo;
- Jazigo de Família.

A cobrança segue o **destino escolhido**.

## A15. Cinzas — documentação

**DECISÃO HUMANA APROVADA**

- certidão de óbito;
- documento pessoal do responsável;
- **certificado de cinzas do crematório, SE POSSÍVEL**.

O certificado de cinzas é **desejável**, e **não** requisito absoluto. **A
ausência dele, isoladamente, não deve bloquear automaticamente** o atendimento.

## A16. Cinzas → Jazigo de Família

**DECISÃO HUMANA APROVADA**

- Cinzas **vindas de fora**: **R$ 94,00**.
- Verificar **situação do jazigo** e **autorização**.

## A17. Jazigo de Família — os dois casos

**DECISÃO HUMANA APROVADA**

Esta é a distinção **crítica** do tópico.

### A17.1 Restos ainda NÃO exumados

- O caso é tratado como **EXUMAÇÃO**.
- O **solicitante deve ser parente de primeiro grau**.
- **NÃO tratar como simples movimentação interna.**

### A17.2 Restos JÁ exumados

- **NÃO há nova Exumação.**
- **R$ 94,00** pela abertura / movimentação.

| Caso | Composição | Total |
| --- | --- | --- |
| Já exumado → ossuário alugado | R$ 94,00 + R$ 386,65 | **R$ 480,65** |
| Já exumado → ossuário perpétuo | R$ 94,00 + R$ 2.955,70 | **R$ 3.049,70** |
| Já exumado → outro cemitério | R$ 94,00 | **R$ 94,00** |

Em nenhum dos três se aplica nova Exumação. **Não aplicar automaticamente o
valor de nova Exumação** ao caso "já exumado → outro cemitério".

## A18. Transporte para outro cemitério — documentação

**DECISÃO HUMANA APROVADA**

Preservar:

- **memorando de origem**;
- **memorando de destino**;
- demais documentos já consolidados.

Quando o destino for **fora de São Paulo** e exigir autorização adicional ou
autorização de delegado:

- quem providencia é a **família** ou o **serviço funerário**;
- **o Cemitério Santana NÃO deve ser apresentado como responsável por obter essa
  autorização para a família.**

## A19. Cremação — procedimentos externos

**DECISÃO HUMANA APROVADA**

- O **serviço funerário** cuida dos procedimentos externos.
- Preservar a orientação já consolidada ao **Crematório da Vila Alpina**.

## A20. Agendamento

**DECISÃO HUMANA APROVADA**

- Retirada / desativação e movimentações **exigem agendamento**.
- O robô abre uma **SOLICITAÇÃO**.
- O robô **NÃO promete data nem horário**.
- **Preferência não é confirmação.**

```
SOLICITACAO DE AGENDAMENTO  !=  AGENDAMENTO CONFIRMADO
```

---

# B) REQUISITOS CONVERSACIONAIS

Comportamento de atendimento. **Nada aqui é regra jurídica ou administrativa**, e
nada aqui pode ser convertido em regra administrativa sem decisão humana
específica.

## B1. Cálculo de valores — não antecipar o total

**REQUISITO CONVERSACIONAL**

Não apresentar total antes de conhecer os fatores necessários. Os fatores são
**distintos entre si**:

```
ORIGEM
LOCALIZACAO ATUAL
EXUMADO OU NAO
MODALIDADE DE OSSUARIO
DESTINO
PENDENCIAS
COBRANCAS DO DESTINO
```

**Não inferir taxa de Exumação apenas porque existem restos mortais em um
jazigo.** A existência de restos num jazigo não diz se eles já foram exumados —
e é essa a diferença entre A17.1 e A17.2.

## B2. Família não sabe o destino

**REQUISITO CONVERSACIONAL**

- Apresentar **brevemente** as alternativas aplicáveis, em vez de apenas
  perguntar "para onde deseja levar?".
- **Não despejar** toda a documentação e todos os valores de uma vez.

```
"AINDA NAO SEI" e ESTADO DE CONVERSA, NAO destino administrativo.
```

Esta é a mesma correção conceitual já registrada em `O5` da decisão de
procedimento de Exumação, e vale igualmente aqui.

## B3. Mudança de destino no meio do atendimento

**REQUISITO CONVERSACIONAL**

- **Não reiniciar** o atendimento.
- **Preservar** informações e documentos que continuam válidos.
- **Atualizar** o destino.
- **Recalcular somente o que for afetado.**

---

# C) GAP / REQUISITO TÉCNICO FUTURO

```
DOMAIN_MODEL_GAP / DECIDED_KNOWLEDGE_AWAITING_FUTURE_IMPLEMENTATION
```

**O conhecimento humano está decidido.** O gap é do modelo técnico atual.

## C1. Separação de estados — eixos hoje colapsados

O modelo futuro **não deve necessariamente colapsar** estes estados num único
status:

```
LOCALIZACAO ATUAL
EXUMADO OU NAO
MODALIDADE DO OSSUARIO
SITUACAO DE VENCIMENTO
PENDENCIA FINANCEIRA
DESTINO PRETENDIDO
DOCUMENTACAO
SOLICITACAO DE AGENDAMENTO
AGENDAMENTO CONFIRMADO
```

Eles **podem ser eixos independentes**. Um caso pode estar simultaneamente
"já exumado", "com pendência financeira", "com destino ainda não definido" e
"sem solicitação aberta" — quatro eixos, quatro valores, nenhum deles derivável
dos outros.

> **Isto é representação conceitual para documentar o gap.** Não é enum, não é
> schema, não é código, e **não deve ser transformado em nenhum dos três nesta
> tarefa**. Os nomes acima descrevem o eixo, não são identificadores propostos.

## C2. O que o modelo atual representa, e o que não representa

Verificado por leitura de `santana-conversation-domain/`:

| Eixo de C1 | Representação hoje | Situação |
| --- | --- | --- |
| exumado ou não | `remains_status` = `SEPULTADO` / `EXUMADO` / `DESCONHECIDO` | **existe** |
| destino pretendido | `transport_destination` = `OUTRO_CEMITERIO` / `JAZIGO_FAMILIA` / `CREMATORIO` / `OSSUARIO` | existe, mas **não distingue ossuário alugado de perpétuo** — e eles diferem no valor cobrado |
| documentação / autorização de destino | `destination_grave_reference`, `destination_grave_situation`, `destination_grave_authorization` | **existe** |
| localização atual (origem) | — | **não existe** como domínio fechado |
| modalidade do ossuário | — | **não existe** |
| situação de vencimento do ossuário alugado | — | **não existe** |
| pendência financeira | — | **não existe** |
| solicitação aberta vs. agendamento confirmado | — | **não existe** |

A ausência de "modalidade do ossuário" é a mais cara: A17.2 separa
**R$ 480,65** de **R$ 3.049,70** exatamente por esse eixo, e hoje os dois casos
colapsam no mesmo valor `OSSUARIO` de `transport_destination`.

## C3. R$ 94,00 não existe no catálogo autoritativo

O catálogo oficial publica hoje **exatamente três** valores: `R$ 106,57`,
`R$ 351,67` e `R$ 586,04`.

**R$ 94,00 não existe lá**, e não aparece em nenhum outro arquivo do
repositório — verificado por varredura. É um **componente autoritativo novo**,
da mesma natureza dos quatro já registrados em `O3` da decisão de procedimento
de Exumação (R$ 386,65 · R$ 2.955,70 · R$ 250,00 · R$ 1.427,86).

| Valor | Componente | Natureza |
| --- | --- | --- |
| R$ 94,00 | abertura / movimentação em jazigo | cobrado quando **não** há nova Exumação (A13, A16, A17.2) |

A aritmética dos totais de A17.2 confirma que R$ 94,00 é **componente**, e não
tarifa fechada, porque ele se soma aos mesmos componentes já registrados:

```
94,00 + 386,65   = 480,65     ossuario alugado
94,00 + 2.955,70 = 3.049,70   ossuario perpetuo
```

**Não criar tarifa monolítica** para R$ 480,65 nem para R$ 3.049,70. Publicar
R$ 94,00 exige o mesmo rito das três tarifas atuais — fonte, aplicabilidade e
vigência declaradas — e altera o `release_id`, com a consequência já registrada:
os vetores do release anterior passam a `INVALIDO`, o que é esperado e **não** é
`FAIL`, e **os vetores congelados da Fase 2 não são reescritos agora**.

## C4. "Valor vigente da aquisição" em A8 não é numeral

A8 diz `R$ 106,57 + valor vigente da aquisição`. **Não presumi** que "valor
vigente da aquisição" seja `R$ 2.955,70`. É plausível que seja — é o valor de
aquisição de ossuário perpétuo registrado na decisão de Exumação do mesmo dia —
mas a decisão de A8 escreve "valor vigente", que é uma **referência a tabela**, e
não um numeral. Quem implementar deve resolver a referência contra a tabela
vigente, não contra este documento.

## C5. "Bloco I" não existe no modelo

A8 determina que os restos sejam transferidos para o **Bloco I**. Não há, no
domínio nem no catálogo, representação de bloco, quadra, setor ou qualquer
localização física de ossuário. `burial_reference` é texto livre e não é domínio
fechado.

Fica registrado como gap. **Não criei o campo.**

## C6. O tipo `TRANSPORTE` continua sem entradas publicadas

`TRANSPORTE` está declarado no catálogo oficial **sem nenhuma entrada**. Hoje o
Gateway responde `NOT_AVAILABLE` / `SEM_FONTE_OFICIAL_CARREGADA` para ele.

As decisões acima fornecem conteúdo para publicá-lo. Publicar altera o catálogo
e, portanto, o `release_id` — mesma consequência de C3.

---

# Correção de A2 — desativação do ossuário alugado

**Histórico preservado. Nada foi apagado.**

O texto anterior, ainda versionado em
`docs/decisoes-humanas/2026-08-19-exumacao-procedimento.md`, item 7, diz:

> - Contrato de **5 anos**.
> - Renovação **de 5 em 5 anos**.
> - Pode renovar **até 1 mês após o vencimento**.
> - Sem renovação, **caracteriza abandono** e os despojos vão para **ossuário
>   geral**.
> - A família **perde acesso normal** aos despojos.
> - Eventual resgate **depende de verificação de possibilidade**. **Não prometer
>   resgate.**

O que **A2 corrige**, explicitamente:

| Antes | Agora |
| --- | --- |
| consequência apresentada como **decorrência direta** da falta de renovação | o ossuário **poderá ser desativado** |
| — | **não afirmar** automaticidade, nem que ocorre exatamente após 1 mês |
| — | se já desativado, **verificar a situação atual** |

O que **A2 não menciona, e portanto permanece** (regra de §1: preservar o que não
foi explicitamente corrigido):

- o prazo de 5 anos e a renovação de 5 em 5 anos;
- a janela de 1 mês para renovar após o vencimento;
- a caracterização de **abandono** e o encaminhamento a **ossuário geral**;
- a perda de acesso normal;
- **não prometer resgate**.

### Pendência de reconciliação documental

```
PENDENCIA_DE_RECONCILIACAO_DOCUMENTAL
```

**Não resolvida aqui, por não ser minha decisão.** A2 remove a automaticidade,
mas não diz o que passa a **acionar** a desativação, nem se "abandono" continua
sendo a caracterização correta quando a desativação é apenas possível e não
automática. As duas leituras compatíveis com os dois textos são:

1. o abandono continua caracterizado pela falta de renovação, e o que deixou de
   ser automático é apenas a **execução** da desativação; ou
2. a caracterização de abandono também passa a depender de verificação
   administrativa.

**Não escolhi entre elas.** A2 prevalece sobre a automaticidade — isso o próprio
decisor determinou. O resto volta ao decisor.

---

# Auditoria de contradições

Varredura feita sobre `docs/`, `santana-conversation-domain/`,
`santana-authority/` e `santana-authority-gateway/`, buscando documentação
anterior que contradissesse cada ponto da revisão.

| # | Ponto auditado | Resultado |
| --- | --- | --- |
| a | cobrança de R$ 94,00 em ossuário → jazigo | **nenhuma contradição.** `R$ 94,00` não aparece em nenhum arquivo do repositório. A5 proíbe acrescentá-lo, e não havia nada afirmando o contrário |
| b | taxa de desativação exclusiva ao ossuário alugado | **nenhuma contradição.** Nenhum documento restringe a taxa ao alugado. `EXUMACAO_DE_OSSUARIO` = R$ 106,57 é declarada sem distinguir modalidade |
| c | desativação automática exatamente 1 mês após o vencimento | **CONTRADIÇÃO ENCONTRADA** — `docs/decisoes-humanas/2026-08-19-exumacao-procedimento.md`, item 7, linha 142: *"Sem renovação, **caracteriza abandono** e os despojos vão para **ossuário geral**"*. Registrada na seção "Correção de A2"; **não resolvida silenciosamente** |
| d | impossibilidade de restos externos entrarem em ossuário | **nenhuma contradição.** Nenhum documento limita ossuários do Santana a exumações do Santana |
| e | taxa adicional de entrada ou reinumação | **nenhuma contradição.** Nenhuma ocorrência de "reinumação" ou "taxa de entrada" no repositório |
| f | cobrar nova Exumação para restos já exumados em jazigo | **nenhuma contradição — há concordância.** `REL_TRANSPORTE_ALREADY_EXHUMED` já assere `exumacao_required = false` para `remains_status = EXUMADO`, e `EXU_RESTOS_JA_EXUMADOS` diz o mesmo no catálogo. A17.2 é consistente com o que já está versionado |
| g | certificado de cinzas como obrigatório absoluto | **nenhuma contradição.** Nenhum documento trata do certificado de cinzas |
| h | responsabilidade do Santana por autorização externa / delegado | **nenhuma contradição.** Nenhum documento atribui essa responsabilidade ao Santana. O item 14 da decisão de Exumação já diz que "Santana cuida apenas do que compete ao Santana" |

## Ponto de atenção que **não** é contradição

O item 10 da decisão de procedimento de Exumação lista `JZ → outro jazigo =
R$ 836,04` (R$ 586,04 + R$ 250,00), enquanto A17.2 registra R$ 94,00 para
movimentação em jazigo.

**Não é conflito**: os dois casos têm situações atuais diferentes. O item 10
pressupõe **exumação acontecendo** (A17.1); A17.2 trata de restos **já
exumados**, onde não há nova Exumação. É exatamente a bifurcação que A17
existe para tornar explícita. **Não alterei nem o item 10 nem A17.**

---

# O que estas decisões NÃO autorizam

- Não autorizam alterar `santana-authority/catalogo/exumacao.v1.json`.
- Não autorizam criar enum, schema ou campo para os eixos de C1.
- Não autorizam tratar `"ainda não sei"` como valor de destino.
- Não autorizam derivar modalidade tarifária a partir do destino — a proibição
  `transport_destination = OSSUARIO` ⇏ `EXUMACAO_DE_OSSUARIO` continua valendo
  integralmente.
- Não autorizam presumir que "valor vigente da aquisição" (A8) seja
  R$ 2.955,70.
- Não autorizam apresentar o Santana como responsável por autorização externa.
- Não autorizam bloquear atendimento de cinzas apenas pela falta do certificado.
- Não autorizam o robô a confirmar agendamento.
- Não autorizam reescrever os vetores congelados da Fase 2.

---

# Fontes canônicas

| | |
| --- | --- |
| Catálogo oficial | `santana-authority/catalogo/exumacao.v1.json` |
| Tópico, goal e relações de Transporte | `santana-conversation-domain/topics.v1.json`, `goals.v1.json`, `relations.v1.json` |
| Fatos e domínios fechados | `santana-conversation-domain/facts.v1.json` |
| Decisão de tarifa e vigência | `docs/decisoes-humanas/2026-08-19-exumacao-tarifa-vigencia.md` |
| Decisão de procedimento de Exumação | `docs/decisoes-humanas/2026-08-19-exumacao-procedimento.md` |
| Decisão de Recadastro | `docs/decisoes-humanas/2026-08-19-recadastro-sucessao-administracao-provisoria.md` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Significado de `INVALIDO` | `conformidade/vetores/FORMATO.md` |
| Estado operacional do projeto | `docs/HANDOFF-PROJETO-SANTANA.md` |
