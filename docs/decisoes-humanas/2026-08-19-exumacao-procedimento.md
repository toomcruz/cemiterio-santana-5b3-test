# Decisão humana — procedimento de EXUMAÇÃO

```
DATA          2026-08-19
DECISOR       mantenedor do projeto
ESCOPO        procedimento de atendimento de EXUMACAO: bifurcacao de origem,
              prazos, destinos, valores, semi-intacto, ossuarios, documentos,
              causa da morte, crematorio, transporte, momento do valor e
              solicitacao de agendamento
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
```

Este documento **registra** decisões. Ele **não** altera runtime, catálogo
autoritativo, vetores, referência Python, Gateway TS/Deno nem código. Nada aqui
está em vigor até ser publicado no catálogo oficial e validado pelos vetores.

## Como ler este documento

```
DECISÃO HUMANA APROVADA   texto do decisor, transcrito. É regra.
OBSERVAÇÃO                nota de quem registrou. NÃO é regra, não vincula
                          ninguém, e existe só para a implementação não
                          tropeçar depois.
```

Toda a parte 1 é **decisão**. Toda a parte 2 é **observação**. Nada foi inferido,
completado ou "arrumado" ao transcrever: onde a decisão não diz, este documento
não diz.

Decisão relacionada, do mesmo dia:
`docs/decisoes-humanas/2026-08-19-exumacao-tarifa-vigencia.md`.

---

# PARTE 1 — DECISÕES HUMANAS APROVADAS

## 1. Primeira bifurcação

**DECISÃO HUMANA APROVADA**

- A exumação deve **primeiro identificar** `QUADRA_GERAL` ou `JAZIGO_DE_FAMILIA`.
- **Não explicar a diferença** se o cidadão souber responder.
- **Só explicar quando houver dúvida.**
- Jazigo de Família: espaço adquirido/concedido à família para sepultar seus
  familiares.
- Quadra Geral: espaço comunitário, com utilização de gaveta por período
  determinado.
- Se continuar sem saber, **seguir para localização/verificação**.

## 2. Inteligência conversacional

**DECISÃO HUMANA APROVADA**

- **Nunca perguntar novamente** informação já fornecida espontaneamente.
- Informação conhecida → **reutilizar**.
- Informação faltante → **perguntar**.
- Informação ambígua → **esclarecer somente a ambiguidade**.
- Informação não necessária ao caso → **não perguntar**.

## 3. Quadra Geral — prazo

**DECISÃO HUMANA APROVADA**

Adulto:

- referência de **3 anos**;
- após 3 anos, a família deve providenciar a exumação, e existe **janela padrão
  de 2 meses**;
- após 3 anos + 2 meses, **NÃO bloquear o atendimento**;
- continuar documentos e solicitação, **alertando** que a situação atual precisa
  ser verificada e que deve providenciar o agendamento o quanto antes;
- **evitar linguagem como "perdeu o prazo"**.

Criança até 6 anos:

- pode exumar **a partir de 2 anos**;
- entre 2 e 3 anos, **pode prosseguir normalmente**;
- **não criar deadline artificial** de 2 anos + 2 meses;
- aos 3 anos, passa para a **lógica operacional padrão**.

## 4. Destinos da Quadra Geral

**DECISÃO HUMANA APROVADA**

Apresentar:

- ossuário alugado Santana;
- ossuário perpétuo individual;
- jazigo de família;
- crematório;
- outro cemitério;
- ainda não sabe.

O **destino precisa estar definido antes da abertura da solicitação de
agendamento**.

## 5. Valores — Quadra Geral

**DECISÃO HUMANA APROVADA**

| Item | Valor |
| --- | --- |
| Exumação (Quadra Geral) | R$ 351,67 |
| Ossuário alugado | R$ 386,65 → **total R$ 738,32** |
| Ossuário perpétuo | R$ 2.955,70 → **total R$ 3.307,37** |
| Jazigo de família | R$ 351,67 + urna para ossos R$ 250,00 → **total R$ 601,67** |
| Crematório | R$ 351,67 |
| Outro cemitério | R$ 351,67 |
| Urna para ossos | R$ 250,00 quando aplicável |

**A Quadra Geral NÃO permite pagamento antecipado.** O pagamento ocorre no dia,
**após** a exumação.

## 6. Semi-intacto — Quadra Geral

**DECISÃO HUMANA APROVADA**

- É **aviso preventivo, não pergunta**.
- Só é **confirmado no dia**.
- Permanência na Quadra Geral: **+3 anos, R$ 1.427,86**.
- Destino era ossuário alugado ou perpétuo e deu semi-intacto: permanece/retorna
  à gaveta por +3 anos; cobrar **R$ 1.427,86**; **não cobrar o ossuário naquele
  momento**.
- Destino era jazigo de família e deu semi-intacto: pode ser sepultado em uma
  gaveta do jazigo; Santana cobra **somente R$ 351,67**; **não cobra urna para
  ossos**; a família providencia urna funerária/caixão externamente.
- Destino crematório: semi-intacto **não impede necessariamente** o
  encaminhamento, desde que procedimentos externos estejam previamente
  organizados.
- Destino outro cemitério: também **pode seguir**, desde que recebimento e
  serviços externos estejam previamente organizados.
- **O robô não deve detalhar procedimentos internos** de funerária, agência,
  crematório ou outro cemitério.

## 7. Ossuário alugado

**DECISÃO HUMANA APROVADA**

- Contrato de **5 anos**.
- Renovação **de 5 em 5 anos**.
- Pode renovar **até 1 mês após o vencimento**.
- Sem renovação, **caracteriza abandono** e os despojos vão para **ossuário
  geral**.
- A família **perde acesso normal** aos despojos.
- Eventual resgate **depende de verificação de possibilidade**. **Não prometer
  resgate.**

## 8. Ossuário perpétuo

**DECISÃO HUMANA APROVADA**

- Aquisição **perpétua**.
- **Individual**.
- Apenas **1 falecido**.
- **Sem renovação periódica**.

## 9. Jazigo de Família — destino

**DECISÃO HUMANA APROVADA**

Pergunta padrão:

> "Após a exumação, a intenção é que os restos mortais permaneçam no próprio
> jazigo?"

- **SIM** → fluxo padrão do próprio jazigo.
- **NÃO** → apresentar: ossuário alugado Santana; ossuário perpétuo; outro
  jazigo; crematório; outro cemitério; ainda não sabe.

Se a resposta já trouxer o destino, **não apresentar o menu de novo**.

## 10. Valores — Jazigo de Família

**DECISÃO HUMANA APROVADA**

| Destino | Composição | Total |
| --- | --- | --- |
| Próprio jazigo | R$ 586,04 + R$ 250,00 | **R$ 836,04** |
| Ossuário alugado | R$ 586,04 + R$ 386,65 | **R$ 972,69** |
| Ossuário perpétuo | R$ 586,04 + R$ 2.955,70 | **R$ 3.541,74** |
| Outro jazigo | — | **R$ 836,04** |
| Crematório | — | **R$ 836,04** |
| Outro cemitério | — | **R$ 836,04** |

**Em Jazigo de Família, pagamento antecipado é permitido.**

## 11. Semi-intacto — Jazigo de Família

**DECISÃO HUMANA APROVADA**

- **NÃO apresentar como aviso padrão** ao cidadão.
- Na operação, exumações de jazigo normalmente ocorrem muitos anos depois.
- Tratar semi-intacto em jazigo **apenas como exceção operacional**.

## 12. Documentos

**DECISÃO HUMANA APROVADA**

Quadra Geral:

- certidão de óbito;
- documento pessoal do solicitante;
- comprovante de residência do solicitante.

Jazigo:

- certidão de óbito;
- documento do solicitante;
- comprovante de residência;
- documento do concessionário **OU** Administrador Provisório, conforme o caso.

**Autorizações/assinaturas ficam separadas da lista de documentos.**

**Reutilizar** as regras já consolidadas de solicitante, vínculo, concessionário
e Administrador Provisório. **Não recriá-las.**

## 13. Causa da morte

**DECISÃO HUMANA APROVADA**

Pergunta aprovada:

> "Para verificar se será necessário algum documento adicional para a exumação,
> o falecimento ocorreu por causa natural ou houve acidente, violência ou alguma
> investigação relacionada?"

- Natural → fluxo normal.
- Acidente/violência/investigação → **NÃO rejeitar**; exigir
  checagem/documentação adicional quando aplicável.
- Não sabe → **não bloquear automaticamente**; permitir validação
  documental/Administração.

## 14. Crematório

**DECISÃO HUMANA APROVADA**

- Para cremação no município de São Paulo, orientar contato com o **Crematório
  da Vila Alpina**.
- Santana cuida **apenas do que compete ao Santana**.
- **Não detalhar** contratação, urna, veículo ou procedimento interno do
  crematório/agência.

## 15. Transporte / outro cemitério

**DECISÃO HUMANA APROVADA**

- **Reutilizar** as regras já consolidadas do tópico **TRANSPORTE DE FALECIDOS E
  RESTOS MORTAIS**.
- **Não duplicar** essas regras dentro de Exumação.

## 16. Momento do valor

**DECISÃO HUMANA APROVADA**

- Informar **assim que houver contexto suficiente** para identificar corretamente
  **origem + destino**.
- Se o cidadão perguntar preço antes, **perguntar somente o mínimo necessário**.
- **Nunca inferir preço/modalidade sem contexto suficiente.**

## 17. Solicitação de agendamento

**DECISÃO HUMANA APROVADA**

- **O robô NÃO agenda.**
- Só abre solicitação quando **todo o conjunto necessário estiver completo**.
- Se faltar documento/requisito, **informar exatamente o que falta** e **NÃO
  abrir solicitação**.
- Exumações: **segunda a sexta-feira, 08:30, 09:00 e 09:30**.
- O cidadão pode indicar **preferência** de dia/horário.
- **Preferência NÃO significa reserva nem confirmação.**
- A equipe analisa documentos, verifica disponibilidade e **confirma
  posteriormente**.

---

# PARTE 2 — OBSERVAÇÕES DE QUEM REGISTROU

**Nada nesta parte é decisão.** São notas de verificação e pontos que a
implementação vai encontrar. Nenhuma delas altera, completa ou reinterpreta o
que está na Parte 1. Onde houver conflito aparente, **a Parte 1 prevalece**, e a
dúvida volta ao decisor.

## O1. Aritmética conferida — os seis totais fecham

Verificado contra os valores da própria decisão:

| Caso | Conta | Total declarado | |
| --- | --- | --- | --- |
| QG → ossuário alugado | 351,67 + 386,65 | R$ 738,32 | confere |
| QG → ossuário perpétuo | 351,67 + 2.955,70 | R$ 3.307,37 | confere |
| QG → jazigo de família | 351,67 + 250,00 | R$ 601,67 | confere |
| JZ → próprio jazigo | 586,04 + 250,00 | R$ 836,04 | confere |
| JZ → ossuário alugado | 586,04 + 386,65 | R$ 972,69 | confere |
| JZ → ossuário perpétuo | 586,04 + 2.955,70 | R$ 3.541,74 | confere |

## O2. Assimetria entre Quadra Geral e Jazigo em crematório e outro cemitério

**Observação, não correção.**

| Destino | Quadra Geral | Jazigo |
| --- | --- | --- |
| Crematório | R$ 351,67 (sem urna) | R$ 836,04 (= 586,04 + 250,00, com urna) |
| Outro cemitério | R$ 351,67 (sem urna) | R$ 836,04 (= 586,04 + 250,00, com urna) |

Na Quadra Geral, crematório e outro cemitério **não** somam a urna de R$ 250,00.
No Jazigo, os mesmos dois destinos chegam a R$ 836,04, que é exatamente
exumação + urna.

Pode ser deliberado — nada na decisão diz que deveria ser simétrico, e a
operação pode ter razão para isso. **Não ajustei nada.** Fica registrado para
confirmação antes de virar tabela publicada.

## O3. Quatro valores desta decisão ainda não existem no catálogo

O catálogo oficial (`santana-authority/catalogo/exumacao.v1.json`) publica hoje
exatamente três valores: `R$ 106,57`, `R$ 351,67` e `R$ 586,04`.

Não existem lá: **R$ 386,65** (ossuário alugado), **R$ 2.955,70** (ossuário
perpétuo), **R$ 250,00** (urna para ossos) e **R$ 1.427,86** (permanência +3
anos por semi-intacto).

Implementar exige publicá-los como entradas com fonte, aplicabilidade e vigência
declaradas — o mesmo rito das três tarifas atuais.

## O4. A origem "retirada/desativação de ossuário" não aparece nestas decisões

A decisão de tarifa do mesmo dia mapeia três origens, incluindo
`RETIRADA_OU_DESATIVACAO_DE_OSSUARIO` → `EXUMACAO_DE_OSSUARIO` → **R$ 106,57**.

As decisões de procedimento acima cobrem **Quadra Geral** e **Jazigo de
Família**. A terceira origem não tem, aqui, fluxo, destinos, documentos nem
regra de semi-intacto.

Isso pode ser deliberado — talvez aquele caso não se atenda por este fluxo.
**Não inventei o fluxo que falta.** Fica registrado como lacuna a confirmar.

## O5. Os destinos decididos não cabem no domínio fechado atual

`transport_destination`, em `santana-conversation-domain/facts.v1.json`, aceita
hoje quatro valores: `OUTRO_CEMITERIO`, `JAZIGO_FAMILIA`, `CREMATORIO`,
`OSSUARIO`.

A decisão do item 4 apresenta **seis** opções e separa dois tipos de ossuário
(alugado e perpétuo), que hoje colapsam num único `OSSUARIO` — e a diferença
entre eles vale **R$ 2.569,05** no total ao munícipe. A opção "ainda não sabe"
também não existe como valor.

O item 9 acrescenta ainda **"outro jazigo"**, que não é `JAZIGO_FAMILIA` (o
próprio) nem `OUTRO_CEMITERIO`.

Implementar exige revisar o domínio fechado. **Não presumi qual valor novo
corresponde a qual opção** — isso é decisão de domínio, e mapear por semelhança
de nome é exatamente o erro que `MAP_MODALIDADE_TARIFARIA` existe para impedir.

## O6. Seis tipos de informação seguem sem entradas publicadas

`DOCUMENTOS`, `PRAZO`, `PROCEDIMENTO_ADMINISTRATIVO`, `REGULARIDADE_DO_JAZIGO`,
`SEMI_INTACTO` e `TRANSPORTE` estão declarados no catálogo **sem nenhuma
entrada**. Hoje o Gateway responde `NOT_AVAILABLE` / `SEM_FONTE_OFICIAL_CARREGADA`
para os seis.

As decisões acima fornecem conteúdo para **quatro** deles — `DOCUMENTOS`
(item 12), `PRAZO` (item 3), `SEMI_INTACTO` (itens 6 e 11) e
`PROCEDIMENTO_ADMINISTRATIVO` (itens 1, 13, 16 e 17). `TRANSPORTE` é remetido ao
tópico próprio (item 15) e `REGULARIDADE_DO_JAZIGO` não é tratado aqui.

Publicá-las altera o catálogo e, portanto, o `release_id` — com a mesma
consequência já registrada na outra decisão do dia: os vetores do release
anterior passam a `INVALIDO`, o que é esperado e **não** é `FAIL`, e **os vetores
congelados da Fase 2 não são reescritos agora**.

## O7. Onde estão as regras que os itens 12 e 15 mandam reutilizar

Para quem implementar não recriar o que já existe:

| Item | Reutilizar de |
| --- | --- |
| 12 — solicitante, vínculo, concessionário, Administrador Provisório | `santana-conversation-domain/relations.v1.json`, `facts.v1.json`, `questions.v1.json`; entradas `EXU_ASSINATURA_*` no catálogo oficial |
| 15 — transporte | tópico `TRANSPORTE` ("Transporte de Falecidos e Restos Mortais") em `santana-conversation-domain/topics.v1.json` |

## O8. Item 2 e o contrato R6 conversam, e não conflitam

O item 2 ("nunca perguntar novamente", "não perguntar o desnecessário") e o
contrato **R6** ("uma pergunta pendente por turno", precedência
`DESAMBIGUACAO_GATEWAY > PROXIMA_PERGUNTA_DO_DOMINIO`) tratam de coisas
diferentes: o item 2 diz **o que** perguntar, o R6 diz **quantas** perguntas por
turno e **qual primeiro**. Registro isso porque as duas regras juntas são mais
restritivas do que cada uma sozinha, e é fácil implementar só uma delas.

Ver `docs/fase2/CONTRATOS-R1-R6.md`.

---

# O que estas decisões NÃO autorizam

- Não autorizam alterar `santana-authority/catalogo/exumacao.v1.json` sem PR.
- Não autorizam reescrever os vetores congelados da Fase 2.
- Não autorizam o LLM a escolher modalidade, valor, prazo ou destino.
- Não autorizam o robô a **agendar** — ele abre solicitação (item 17).
- Não autorizam prometer resgate de despojos em ossuário geral (item 7).
- Não autorizam detalhar procedimento interno de funerária, agência, crematório
  ou outro cemitério (itens 6 e 14).
- Não autorizam preencher, por inferência, as lacunas registradas em O2, O4 e O5.

# Fontes canônicas

| | |
| --- | --- |
| Catálogo oficial | `santana-authority/catalogo/exumacao.v1.json` |
| Domínio (fatos, relações, perguntas, tópicos) | `santana-conversation-domain/` |
| Decisão de tarifa e vigência do mesmo dia | `docs/decisoes-humanas/2026-08-19-exumacao-tarifa-vigencia.md` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Vetores e o significado de `INVALIDO` | `docs/fase2/VETORES-V1-V12.md` |
| Estado operacional do projeto | `docs/HANDOFF-PROJETO-SANTANA.md` |
