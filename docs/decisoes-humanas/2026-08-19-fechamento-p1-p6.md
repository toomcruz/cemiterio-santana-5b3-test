# Decisão humana — fechamento de P1 a P6 (pendências da auditoria pré-Fase 4)

```
DATA          2026-08-19
DECISOR       mantenedor do projeto
ESCOPO        as seis decisoes humanas pendentes identificadas na auditoria
              cruzada pre-Fase 4
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
BASE          docs/decisoes-humanas/2026-08-19-auditoria-cruzada-pre-fase-4.md
              SHA cf66ad99811a7117d348994897a5dd1f211524a8
```

Este documento **registra** decisões. Ele **não** altera runtime, catálogo
autoritativo, domínio, schemas, contratos, enums, vetores, referência Python,
Gateway TS/Deno, workflows, Supabase, n8n nem `release_id`. Nada aqui está em
vigor até ser publicado e validado.

Com este documento:

```
DECISOES_HUMANAS_PENDENTES = 0
```

---

# P1 — Ossuário alugado vencido

```
P1 = RESOLVIDA
```

## Decisão

**A falta de renovação NÃO caracteriza automaticamente abandono.**
**A desativação também NÃO deve ser afirmada automaticamente.**

Regra conversacional:

- contrato: **5 anos**;
- após o vencimento, existe período de **1 mês** para renovação;
- **até 1 ano** de vencimento: **não emitir automaticamente** alerta sobre
  abandono ou desativação;
- verificar a situação **quando isso for necessário** para o atendimento;
- vencido há **mais de 1 ano**: informar que a **situação atual precisa ser
  verificada** antes de confirmar renovação, disponibilidade ou movimentação;
- **mesmo após mais de 1 ano**, não afirmar automaticamente abandono;
- **não afirmar automaticamente desativação**;
- **a Administração verifica** a situação atual.

Formulação aceitável para o caso de mais de 1 ano:

> "Como o ossuário está vencido há mais de um ano, precisamos verificar a
> situação atual antes de confirmar a disponibilidade para renovação ou
> movimentação."

## O que esta decisão supera

```
SUPERADA
```

O item 7 de `docs/decisoes-humanas/2026-08-19-exumacao-procedimento.md`, na parte
que diz:

> "Sem renovação, **caracteriza abandono** e os despojos vão para **ossuário
> geral**."

**A associação automática entre falta de renovação e abandono está superada.**
O texto anterior **permanece versionado** e não foi apagado — está preservado
naquele documento e citado na seção "Correção de A2" da decisão de Transporte.

## O que esta decisão NÃO diz

Ela **não** afirma que abandono e encaminhamento a ossuário geral deixaram de
existir como desfecho possível. Ela remove a **automaticidade** e o **anúncio
automático**, e encaminha à verificação da Administração. **Não inferi** o que
não está escrito.

Continuam valendo, por não terem sido corrigidos: o contrato de 5 anos, a
renovação de 5 em 5 anos, a janela de 1 mês, a perda de acesso normal em caso de
abandono efetivamente caracterizado, e **não prometer resgate**.

## Três faixas de tempo

```
DENTRO DA VIGENCIA          fluxo normal
VENCIDO ATE 1 ANO           nao alertar automaticamente; verificar se preciso
VENCIDO HA MAIS DE 1 ANO    informar que a situacao precisa ser verificada
```

O limite de **1 ano** é novo e não existia em nenhuma decisão anterior.

---

# P2 — Códigos de modalidade

```
P2 = RESOLVIDA
```

## Decisão

**Manter os códigos atuais do catálogo.**

O prefixo `EXUMACAO_` usado na documentação **não representa pedido de
renomeação** dos códigos autoritativos existentes.

- **não renomear códigos**;
- **não alterar `release_id`** por este motivo;
- registrar a equivalência documental quando necessário.

## Equivalência documental

| Escrito na documentação | Código autoritativo válido |
| --- | --- |
| `EXUMACAO_SEPULTURA_CESSAO_GAVETA_UNITARIA_PRAZO_FIXO` | `SEPULTURA_CESSAO_GAVETA_UNITARIA_PRAZO_FIXO` |
| `EXUMACAO_SEPULTURA_CESSAO_TERRENO_PRAZO_INDETERMINADO` | `SEPULTURA_CESSAO_TERRENO_PRAZO_INDETERMINADO` |
| `EXUMACAO_DE_OSSUARIO` | `EXUMACAO_DE_OSSUARIO` (idêntico) |

**O catálogo é a autoridade sobre o nome do código.** A documentação descreve; o
catálogo define.

## Princípio geral que esta decisão estabelece

```
NOME ESCRITO EM DOCUMENTACAO  !=  PEDIDO DE RENOMEACAO DE DADO AUTORITATIVO
```

Este princípio é aplicável além de P2 — ver a nota em P3 sobre o nome da
terceira categoria de origem.

## Divergência 3.1 encerrada

A divergência 3.1 de
`docs/decisoes-humanas/2026-08-19-exumacao-tarifa-vigencia.md` está **resolvida
pela primeira leitura**: os códigos do catálogo permanecem como estão, e a
decisão de tarifa se refere a eles.

---

# P3 — Descoberta da origem

```
P3 = RESOLVIDA
```

## Decisão

A **origem** deve ser representada conceitualmente como **informação própria**,
separada do **destino** e da **localização física**.

Categorias necessárias:

```
QUADRA_GERAL
JAZIGO_DE_FAMILIA
OSSUARIO
```

## A numeração de quadra não determina a origem

No Cemitério Santana existem **Quadra Geral 1**, **Quadra Geral 2** e **Quadra
Geral 3**. Mas:

- o munícipe normalmente **não sabe** a numeração/localização técnica;
- o robô **não deve exigir** que ele saiba Quadra Geral 1/2/3;
- o robô **não deve inferir** `QUADRA_GERAL` só porque o munícipe informou "uma
  quadra" ou um número de quadra;
- **uma numeração de quadra também pode fazer parte da localização de um Jazigo
  de Família.**

```
"quadra 3"  ->  NAO significa QUADRA_GERAL
```

Esta é a mesma classe de erro que `MAP_MODALIDADE_TARIFARIA` existe para
impedir: semelhança de nome não é identidade de conceito.

## Regra de descoberta

1. origem **inequivocamente conhecida** pelo contexto → **reutilizar**;
2. origem **ambígua** → **perguntar em linguagem comum**;
3. munícipe **não sabe** → **permitir verificação** pelos dados disponíveis;
4. **nunca derivar modalidade tarifária apenas de número/localização**;
5. **origem e destino permanecem eixos separados.**

## Dois eixos que ficam separados por decisão

```
ORIGEM ADMINISTRATIVA     QUADRA_GERAL | JAZIGO_DE_FAMILIA | OSSUARIO
LOCALIZACAO FISICA        Quadra Geral 1 | 2 | 3, terreno, rua, gaveta...
```

A localização física **descreve onde**; a origem administrativa **determina a
modalidade tarifária**. A regra 4 proíbe explicitamente que a segunda seja
derivada da primeira.

## Duas colisões de nome que ficam registradas, e não resolvidas aqui

**Colisão 1 — `OSSUARIO` como origem e como destino.**

```
transport_destination = OSSUARIO   (destino, ja existe no dominio)
origem = OSSUARIO                  (origem, esta decisao)
```

São **eixos diferentes com o mesmo texto**. A regra 5 e a proibição já
consolidada (`transport_destination = OSSUARIO` **não** implica
`EXUMACAO_DE_OSSUARIO`) continuam valendo integralmente. **Não presumi** que
devam compartilhar identificador, nem que devam ser distintos — isso é desenho da
Fase 4, sob a regra 5.

**Colisão 2 — nome da terceira categoria.**

A decisão de tarifa escreve `RETIRADA_OU_DESATIVACAO_DE_OSSUARIO`; P3 escreve
`OSSUARIO`. Pelo princípio estabelecido em P2 — *nome escrito em documentação
não é pedido de renomeação* —, **não tratei os dois como conflito** e **não
escolhi um deles**. São o mesmo eixo descrito com dois nomes; qual identificador
será publicado é decisão de publicação, não desta consolidação.

## Divergência 3.2 encerrada

A divergência 3.2 de `2026-08-19-exumacao-tarifa-vigencia.md` está **resolvida
pela primeira opção**: cria-se representação própria para a situação de origem.
A segunda opção — perguntar sempre — não foi escolhida como mecanismo único: a
pergunta existe, mas apenas na **regra 2**, quando há ambiguidade.

**Nenhum campo, enum ou schema criado nesta tarefa.**

---

# P4 — Urna de R$ 250,00

```
P4 = RESOLVIDA
```

## Decisão

Na exumação de **Quadra Geral** com destino a **cremação** ou **outro
cemitério**:

- a exumação é cobrada normalmente: **R$ 351,67**;
- a urna para ossos de **R$ 250,00** é **OPCIONAL**.

| Caso | Total |
| --- | --- |
| sem urna | **R$ 351,67** |
| com urna | **R$ 601,67** |

**Não adicionar automaticamente a urna.**

- **preservar** as regras específicas já consolidadas para Jazigo de Família e
  demais cenários;
- **não presumir simetria** entre modalidades.

## O que isto esclarece

A observação `O2` da decisão de procedimento de Exumação registrava a assimetria
entre Quadra Geral e Jazigo nesses dois destinos e a deixava para confirmação.
**A assimetria é deliberada**, e agora se sabe por quê: na Quadra Geral a urna é
**opcional**, e o valor publicado de R$ 351,67 é o caso **sem** urna.

`O2` fica **encerrada**. **Não alterei aquele documento.**

## O que permanece inalterado

Os valores de Jazigo de Família continuam como decididos — inclusive
**R$ 836,04** para crematório e outro cemitério. A decisão manda expressamente
preservá-los e **não** presumir simetria, então **não** estendi a opcionalidade
da urna ao Jazigo.

Aritmética conferida: `351,67 + 250,00 = 601,67`. Confere.

---

# P5 — Taxa de R$ 94,00

```
P5 = RESOLVIDA
```

## Decisão

Administrativamente, trata-se da **MESMA taxa interna** de **R$ 94,00**.

Ela é utilizada em **processos/contextos diferentes**, incluindo:

- abertura/movimentação em jazigo;
- etapa inicial do Processo de Concessão.

```
MESMA TAXA  +  CONTEXTOS DE APLICACAO DIFERENTES
```

- o modelo futuro deve **preservar o motivo/processo de aplicação**;
- **não duplicar conceitualmente** a taxa apenas porque aparece em fluxos
  distintos.

## Regra específica preservada

```
ossuario -> jazigo
  NAO acrescentar automaticamente R$ 94,00
  aplicar a regra ja decidida: somente R$ 106,57
```

Esta regra de Transporte `A5` **continua valendo integralmente**. A unificação da
taxa **não** a afrouxa: uma taxa única com contextos declarados torna essa
exceção **mais** fácil de expressar, não menos — o contexto "ossuário → jazigo"
simplesmente não é um dos contextos de aplicação.

## Consequência para o registro anterior

O gap `C3` da decisão de Processo de Concessão registrava a colisão e deixava a
escolha para o decisor, com a ressalva de que publicar como entrada única faria
uma alteração futura de um lado mexer silenciosamente no outro.

**A decisão é entrada única, com o contexto preservado.** O risco continua real e
agora tem mitigação declarada: se o motivo/processo de aplicação for registrado
junto, uma alteração futura pode ser avaliada **por contexto** em vez de
propagar cega. Publicar sem o contexto reintroduziria o risco integralmente.

---

# P6 — Vigência dos valores

```
P6 = RESOLVIDA
```

## Decisão

Aplicar a vigência operacional:

```
01/01/2026  ate  31/12/2026
```

aos seguintes valores:

| Valor | Componente |
| --- | --- |
| R$ 386,65 | ossuário alugado |
| R$ 2.955,70 | aquisição de ossuário perpétuo |
| R$ 250,00 | urna para ossos |
| R$ 1.427,86 | permanência adicional de 3 anos no cenário semi-intacto correspondente |
| R$ 94,00 | taxa interna utilizada nos contextos já consolidados |

A vigência é a mesma já decidida para a tabela tarifária em
`2026-08-19-exumacao-tarifa-vigencia.md`, **com as duas extremidades
inclusivas**.

## Sobre a fonte

Estes valores foram **confirmados como decisões humanas operacionais do
Cemitério Santana** nesta consolidação.

```
NAO inventar numero de portaria, decreto, documento oficial,
URL ou fonte externa inexistente.
```

**Nenhuma fonte foi inventada.** As quatro fontes declaradas hoje em
`santana-authority/catalogo/exumacao.v1.json` são três catálogos de domínio e a
tabela `Tabela_Politica_Tarifaria_07_01_2026` — e **nenhuma delas cobre estes
cinco valores**.

O registro da decisão humana **não está bloqueado** por essa ausência. O que fica
registrado é a lacuna do modelo de proveniência:

```
GAP DE PROVENIENCIA
```

Toda entrada do catálogo exige `source_id`, e toda fonte em `fontes[]` declara
`tipo` e `referencia`. Hoje não existe tipo de fonte que represente **decisão
humana operacional consolidada** — os tipos existentes são `CATALOGO_DOMINIO` e
`TABELA_TARIFARIA_OFICIAL`. Publicar estes cinco valores exige que o modelo de
proveniência acomode essa natureza, **sem fabricar um documento que não foi
fornecido**.

Registrado na auditoria como **`G19`**. **Nenhuma fonte criada nesta tarefa.**

---

# Consolidação — o que muda e o que não muda

## Muda

| | |
| --- | --- |
| P1 | supera a associação automática falta de renovação → abandono; cria a faixa de 1 ano |
| P2 | encerra a divergência 3.1: códigos do catálogo permanecem |
| P3 | origem passa a ser eixo próprio, com três categorias; encerra a divergência 3.2 |
| P4 | confirma a assimetria como deliberada; urna opcional em Quadra Geral → cremação/outro cemitério; encerra `O2` |
| P5 | R$ 94,00 é **uma** taxa com contextos declarados |
| P6 | vigência 01/01/2026–31/12/2026 para os cinco valores; abre `G19` |

## Não muda

- nenhum valor foi alterado;
- nenhum código autoritativo foi renomeado;
- `release_id` intacto — `exu-1.0-32cc48f26797`;
- os sete documentos de tópico permanecem como estão, **inclusive os trechos
  superados**, que ficam preservados como histórico;
- vetores congelados da Fase 2 **não** reescritos;
- a proibição `transport_destination = OSSUARIO` ⇏ `EXUMACAO_DE_OSSUARIO`
  continua integral;
- Transporte `A5` (ossuário → jazigo, somente R$ 106,57) continua integral.

## O que estas decisões NÃO autorizam

- Não autorizam alterar o catálogo autoritativo sem PR.
- Não autorizam criar campo, enum ou schema para a origem de P3.
- Não autorizam inferir `QUADRA_GERAL` a partir de número de quadra.
- Não autorizam derivar modalidade tarifária de localização física.
- Não autorizam tratar origem e destino como o mesmo eixo, ainda que o texto
  `OSSUARIO` coincida.
- Não autorizam acrescentar a urna automaticamente.
- Não autorizam estender a opcionalidade da urna ao Jazigo de Família.
- Não autorizam acrescentar R$ 94,00 em ossuário → jazigo.
- Não autorizam publicar os cinco valores sem resolver `G19`.
- Não autorizam inventar portaria, decreto, URL ou documento oficial.
- Não autorizam afirmar abandono ou desativação automaticamente, em nenhuma
  faixa de tempo.
- Não autorizam iniciar a Fase 4.

---

# Fontes canônicas

| | |
| --- | --- |
| Auditoria que identificou P1–P6 | `docs/decisoes-humanas/2026-08-19-auditoria-cruzada-pre-fase-4.md` |
| Divergências 3.1 e 3.2, e `MAP_VIGENCIA` | `docs/decisoes-humanas/2026-08-19-exumacao-tarifa-vigencia.md` |
| Item 7 (superado por P1), item 5, `O2`, `O3` | `docs/decisoes-humanas/2026-08-19-exumacao-procedimento.md` |
| `A2` (correção anterior), `A5`, `C3` | `docs/decisoes-humanas/2026-08-19-transporte-falecidos-e-restos-mortais.md` |
| `A4`, `C3` (colisão de R$ 94,00) | `docs/decisoes-humanas/2026-08-19-processo-de-concessao.md` |
| Catálogo, `fontes[]` e `source_id` | `santana-authority/catalogo/exumacao.v1.json` |
| Estado operacional | `docs/HANDOFF-PROJETO-SANTANA.md` |
