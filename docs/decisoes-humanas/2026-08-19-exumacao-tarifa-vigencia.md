# Decisão humana — modalidade tarifária e vigência da tabela (EXUMAÇÃO)

```
DATA          2026-08-19
DECISOR       mantenedor do projeto
ESCOPO        MAP_MODALIDADE_TARIFARIA, MAP_VIGENCIA_TABELA_TARIFARIA
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
```

Este documento **registra** a decisão. Ele **não** altera runtime, catálogo
autoritativo, vetores nem código. Nada aqui está em vigor até ser implementado
no catálogo oficial e validado pelos vetores.

Histórico preservado: até esta data as duas questões estavam declaradas como
`PENDENTE_DE_DECISAO_HUMANA` e `PENDENTE_DE_CONFIRMACAO_HUMANA` em
`mapeamentos_pendentes`, dentro de `santana-authority/catalogo/exumacao.v1.json`.
Enquanto não implementadas, **continuam pendentes no runtime**.

---

## 1. MAP_MODALIDADE_TARIFARIA — decidido

| Situação de origem | Modalidade tarifária | Valor |
| --- | --- | --- |
| `QUADRA_GERAL` | `EXUMACAO_SEPULTURA_CESSAO_GAVETA_UNITARIA_PRAZO_FIXO` | R$ 351,67 |
| `JAZIGO_DE_FAMILIA` | `EXUMACAO_SEPULTURA_CESSAO_TERRENO_PRAZO_INDETERMINADO` | R$ 586,04 |
| `RETIRADA_OU_DESATIVACAO_DE_OSSUARIO` | `EXUMACAO_DE_OSSUARIO` | R$ 106,57 |

### Regra obrigatória, que a decisão reafirma

```
transport_destination = OSSUARIO   NAO implica   EXUMACAO_DE_OSSUARIO
```

`EXUMACAO_DE_OSSUARIO` só se aplica quando os restos **já estão em ossuário** e
estão sendo **retirados ou desativados** de lá. É a exumação **feita num**
ossuário. O destino `OSSUARIO` descreve para **onde** os restos vão depois, e
não determina modalidade nenhuma.

A decisão, portanto, **não** afrouxa a proibição do homônimo — ela a confirma e
lhe dá a alternativa correta: a modalidade vem da **origem**, nunca do destino.

---

## 2. MAP_VIGENCIA_TABELA_TARIFARIA — decidido

```
vigente_de   = 2026-01-01
vigente_ate  = 2026-12-31
```

**Ambas as extremidades são inclusivas.** `2026-01-01` e `2026-12-31` são dias
vigentes.

> Esta decisão **SUBSTITUI** o estado atual do catálogo, que ainda representa
> início em `2026-01-07` e **ausência de fim**. Não é confirmação da leitura
> anterior: é outra data em cada uma das duas pontas. Ver 3.3 e a seção 4.

| Data de referência | Comportamento exigido |
| --- | --- |
| anterior a `2026-01-01` | **não aplicar** esta tabela |
| entre as duas datas, inclusive | tabela vigente |
| posterior a `2026-12-31` | **não aplicar automaticamente**; exigir nova tabela válida |

O Gateway já implementa a semântica pedida para o terceiro caso: fora de
vigência, a consulta responde `NOT_AVAILABLE` com motivo `SEM_ENTRADA_VIGENTE` e
encaminha à Administração. Isso é comportamento existente, provado pelo vetor
V8, e não depende desta decisão — o que a decisão faz é **declarar as datas**.

---

## 3. Divergências entre a decisão e o catálogo atual

Registradas aqui **sem correção automática**. Nenhuma delas invalida a decisão;
todas precisam ser resolvidas antes ou durante a implementação, por quem
implementar, e algumas podem exigir nova confirmação do decisor.

### 3.1 Dois dos três códigos de modalidade não existem no catálogo

Os **valores** conferem nos três casos. Os **códigos** não:

| Código na decisão | Código no catálogo | Situação |
| --- | --- | --- |
| `EXUMACAO_SEPULTURA_CESSAO_GAVETA_UNITARIA_PRAZO_FIXO` | `SEPULTURA_CESSAO_GAVETA_UNITARIA_PRAZO_FIXO` | prefixo `EXUMACAO_` a mais |
| `EXUMACAO_SEPULTURA_CESSAO_TERRENO_PRAZO_INDETERMINADO` | `SEPULTURA_CESSAO_TERRENO_PRAZO_INDETERMINADO` | prefixo `EXUMACAO_` a mais |
| `EXUMACAO_DE_OSSUARIO` | `EXUMACAO_DE_OSSUARIO` | idêntico |

**Não presumi que o prefixo seja engano de digitação.** Renomear código de
modalidade é alteração de dado autoritativo e muda o `release_id`. Quem
implementar precisa decidir, com o decisor, uma das duas leituras:

- os códigos do catálogo permanecem como estão, e a decisão se refere a eles;
- os códigos do catálogo passam a levar o prefixo `EXUMACAO_`, e isso é uma
  alteração deliberada da fonte.

### 3.2 As três chaves de origem não existem no domínio

`QUADRA_GERAL`, `JAZIGO_DE_FAMILIA` e `RETIRADA_OU_DESATIVACAO_DE_OSSUARIO`
**não aparecem em nenhum lugar** de `santana-conversation-domain/` nem do
catálogo oficial. Verificado por varredura.

Os fatos existentes hoje que chegam perto, e por que não servem:

| Fato | Valores | Por que não serve |
| --- | --- | --- |
| `transport_destination` | `OUTRO_CEMITERIO`, `JAZIGO_FAMILIA`, `CREMATORIO`, `OSSUARIO` | é **destino**, e a própria decisão proíbe derivar modalidade do destino |
| `exhumation_purpose` | `TRANSPORTE`, `OSSUARIO`, `CREMACAO`, `OUTRA` | é finalidade, não origem |
| `remains_status` | `SEPULTADO`, `EXUMADO`, `DESCONHECIDO` | não descreve o tipo de sepultura |
| `burial_reference` | texto livre | não é domínio fechado |

Note que `transport_destination` traz `JAZIGO_FAMILIA` e a decisão escreve
`JAZIGO_DE_FAMILIA`. **São campos diferentes com nomes parecidos** — exatamente
a classe de confusão que `MAP_MODALIDADE_TARIFARIA` existe para impedir. Tratá-los
como o mesmo valor reintroduziria o erro que a decisão acabou de proibir.

**Consequência:** a decisão é semanticamente completa, mas **não é derivável do
estado atual do caso**. Implementá-la exige uma das duas coisas, e a escolha é
decisão humana:

1. criar um fato novo de domínio fechado para a situação de origem (com os três
   valores acima), passando por `facts.v1.json` e pelo perfil de conformidade; ou
2. perguntar a modalidade diretamente ao munícipe, nos termos da própria tabela,
   com o léxico de apresentação do R5 traduzindo os códigos.

### 3.3 A vigência decidida difere da que está no catálogo

| | Catálogo hoje | Decisão |
| --- | --- | --- |
| início | `2026-01-07` | `2026-01-01` |
| fim | `null` (sem fim) | `2026-12-31` |

O `2026-01-07` veio da leitura `dd_mm_aaaa` do nome do arquivo
`Tabela_Politica_Tarifaria_07_01_2026`, registrada como pendente justamente por
não estar declarada na fonte. **A decisão não confirma aquela leitura: substitui
as duas pontas.** É alteração de dado, não confirmação.

---

## 4. Consequência para os vetores de conformidade

Implementar esta decisão **altera o catálogo oficial**, e o `release_id` é
derivado do conteúdo. Portanto:

```
release_id atual   exu-1.0-32cc48f26797
release_id depois  outro, ainda não calculado
```

Os **36 casos** que rodam contra o catálogo oficial passam a resultar
`INVALIDO` — não `FAIL`. Esse é precisamente o caso que o estado `INVALIDO`
existe para cobrir: *o vetor não roda porque foi executado contra outro
conhecimento*. Regerá-los sob o novo `release_id` **não** é "ajustar vetor para
implementação passar"; é reconhecer que o conhecimento mudou. A regra que
continua valendo é a outra: nenhum vetor é ajustado para acomodar divergência
**dentro do mesmo release**.

Um caso muda de resultado esperado por mérito, e não só por `release_id`:

| Caso | Hoje | Depois da decisão |
| --- | --- | --- |
| `V04-C` — `PRECO` em `2026-01-06` | `SEM_ENTRADA_VIGENTE` | passa a estar **vigente**, porque o início recua para `2026-01-01` |

Consequências previstas, em ordem:

1. implementar a nova vigência **altera o conteúdo autoritativo**;
2. portanto o **`release_id` deverá mudar**;
3. vetores ligados ao release anterior **deverão resultar `INVALIDO`** quando
   executados contra o novo release;
4. isso é **comportamento esperado, e não `FAIL`**;
5. o **`V04-C` deixa de provar "antes da vigência"**, porque `2026-01-06` passa a
   estar **dentro** da vigência decidida.

### Ressalva de versionamento — não reescrever agora

```
NAO alterar nem reescrever agora os vetores congelados da Fase 2.
```

Os vetores atuais **permanecem preservados como evidência do release anterior**.
Eles não estão errados: eles descrevem, com fidelidade, o conhecimento que
vigorava sob `exu-1.0-32cc48f26797`. Apagá-los ou editá-los agora destruiria a
única prova de que aquele release se comportava como se afirmou que ele se
comportava.

Quando a decisão for implementada, em fase posterior, **a conformidade do novo
release deverá ser versionada de forma que o conjunto antigo continue
recuperável**. O mecanismo fica a critério de quem implementar; o requisito não:
recuperabilidade do conjunto anterior, sem depender de branch viva.

No novo release, o teste equivalente ao `V04-C` deverá usar uma data
**realmente anterior** a `2026-01-01` — por exemplo `2025-12-31` — de modo a
continuar provando indisponibilidade por vigência. Isso vale para o **novo**
conjunto. **O vetor congelado não é alterado agora.**

---

## 5. O que esta decisão NÃO autoriza

- Não autoriza alterar `santana-authority/catalogo/exumacao.v1.json` sem PR.
- Não autoriza inferir modalidade a partir de `transport_destination`.
- Não autoriza tratar `JAZIGO_FAMILIA` (destino) e `JAZIGO_DE_FAMILIA` (origem)
  como o mesmo valor.
- Não autoriza renomear código de modalidade sem decisão explícita — ver 3.1.
- Não autoriza o LLM a escolher modalidade. Com a decisão implementada, a
  modalidade passa a ser **derivada de fato confirmado** ou **perguntada**;
  nunca inferida por semelhança de nome.

---

## 6. Fontes canônicas

| | |
| --- | --- |
| Catálogo oficial e `mapeamentos_pendentes` | `santana-authority/catalogo/exumacao.v1.json` |
| Fatos e domínios fechados | `santana-conversation-domain/facts.v1.json` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Vetores e o significado de `INVALIDO` | `docs/fase2/VETORES-V1-V12.md`, `conformidade/vetores/FORMATO.md` |
| Estado operacional do projeto | `docs/HANDOFF-PROJETO-SANTANA.md` |
