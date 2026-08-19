# Decisão humana — RECADASTRO: sucessão e Administração Provisória

```
DATA          2026-08-19
DECISOR       operador do Cemiterio Santana
ESCOPO        RECADASTRO: conducao do atendimento, sucessao, Administracao
              Provisoria, conflito familiar, linha lateral, validade e segunda
              Administracao Provisoria, troca voluntaria, GOV.BR, falecimento do
              Administrador Provisorio, consulta cadastral, divergencia
              cadastral, controle documental, retomada e multiplos assuntos
ESTADO        DECIDIDO, AGUARDANDO IMPLEMENTACAO
```

Este documento **registra** decisões. Ele **não** altera runtime, catálogo
autoritativo, catálogos de domínio, schemas, enums, contratos, vetores
congelados, referência Python, Gateway TS/Deno nem código. Nada aqui está em
vigor até ser publicado e validado.

## Como ler este documento

As decisões estão classificadas em três categorias, e a distinção é vinculante:

```
A) DECISAO HUMANA APROVADA
   regra operacional fornecida pelo operador do Cemiterio Santana.
   E regra administrativa.

B) REQUISITO CONVERSACIONAL
   comportamento esperado do robo, derivado dessas regras.
   NAO e decisao juridica nem administrativa.

C) GAP / REQUISITO TECNICO FUTURO
   necessidade arquitetural identificada e ainda NAO implementada.
```

Nada foi inferido ou completado ao transcrever. Onde a decisão não diz, este
documento não diz.

## O que já existia e NÃO foi recriado

RECADASTRO já tem conteúdo consolidado no domínio. Este documento **complementa**
e, num ponto, **corrige** — não recria nada:

| Já consolidado | Onde |
| --- | --- |
| Tópico `RECADASTRO` | `santana-conversation-domain/topics.v1.json` |
| `GOAL_RECADASTRO`, exigindo `concession_reference` e `recadastro_holder_document` | `goals.v1.json` |
| `recadastro_status` (`OK` / `PENDENTE` / `DESCONHECIDO`), com resolução autoritativa | `facts.v1.json`, `questions.v1.json` |
| `concession_reference`, `recadastro_holder_document`, `concession_purpose` | `facts.v1.json` |
| `recadastro_required` e `recadastro_verification_required`, derivados | `facts.v1.json` |
| `REL_CONCESSAO_REQUIRES_RECADASTRO`, `REL_CONCESSAO_RECADASTRO_UNKNOWN` | `relations.v1.json` |
| Recadastro desconhecido ⇒ encaminhar verificação, sem presumir `OK` nem `PENDENTE` | `santana-conversation-domain/README.md`, regra 3 |
| `recadastro_status = OK` só por sinal autoritativo | idem, regra 4 |

Decisões relacionadas, do mesmo dia:
`2026-08-19-exumacao-tarifa-vigencia.md` e `2026-08-19-exumacao-procedimento.md`.

---

# A) DECISÕES HUMANAS APROVADAS

## A1. Concessionário vivo — quem conduz e quem assina

**DECISÃO HUMANA APROVADA**

- Um familiar **pode conduzir** o atendimento de Recadastro quando o
  concessionário está vivo.
- O familiar **pode fornecer informações e encaminhar documentos**.
- Isso **NÃO** transforma o familiar em Administrador Provisório.
- O Recadastro continua **vinculado ao concessionário vivo**.
- A assinatura final continua sendo **obrigatoriamente do concessionário**.

Princípio:

```
CONDUZIR O ATENDIMENTO  !=  SER O RESPONSAVEL PELA ASSINATURA
```

## A2. Concessionário falecido — Administração Provisória

**DECISÃO HUMANA APROVADA**

- Quando o concessionário faleceu, deve ser analisada a **linha sucessória** para
  definição do Administrador Provisório.
- Pode existir **somente 1** Administrador Provisório por jazigo ou ossuário.
- **Nunca** podem existir dois Administradores Provisórios simultaneamente.

## A3. Linha sucessória direta

**DECISÃO HUMANA APROVADA**

- Existindo sucessor direto elegível, **somente a linha sucessória direta** pode
  fornecer o Administrador Provisório.
- A linha lateral **NÃO** pode assumir simplesmente porque os sucessores diretos
  não querem assumir.
- Um **filho maior** pode assumir a Administração Provisória.
- A existência de **cônjuge vivo NÃO obriga** o cônjuge a ser Administrador
  Provisório.
- Um filho maior **pode assumir mesmo quando o cônjuge do concessionário está
  vivo**.

As demais regras sucessórias já consolidadas anteriormente permanecem válidas.

## A4. Conflito entre familiares

**DECISÃO HUMANA APROVADA**

Se dois ou mais familiares elegíveis quiserem assumir a Administração
Provisória:

- o robô **NÃO escolhe**;
- o sistema **NÃO arbitra** quem tem preferência;
- a família precisa **decidir entre si** quem será o único Administrador
  Provisório;
- enquanto não houver essa definição, o jazigo **permanece em situação
  irregular**.

## A5. Linha lateral

**DECISÃO HUMANA APROVADA**

A linha lateral somente pode ser utilizada quando **NÃO houver sucessor direto
aplicável**.

**Irmão do concessionário:**

- pode assumir pela linha lateral quando não existir sucessor direto;
- deve apresentar a **certidão de óbito do concessionário**, além dos demais
  documentos aplicáveis.

**Sobrinho do concessionário:** deve ser comprovada a cadeia

```
CONCESSIONARIO
  -> irmao/irma do concessionario
     -> sobrinho
```

Devem ser apresentados os óbitos necessários para comprovar a cadeia, incluindo:

- certidão de óbito do concessionário;
- certidão de óbito do pai ou mãe do sobrinho que era irmão/irmã do
  concessionário.

Princípio:

> A linha lateral deve ser **documentalmente comprovada** pelos elos necessários
> até o concessionário.

**Não existe hierarquia adicional de parentes laterais além da aprovada acima.**

## A6. Validade e segunda Administração Provisória — CORREÇÃO

```
ESTA DECISAO CORRIGE a interpretacao anterior de que, apos o vencimento da
primeira Administracao Provisoria, seria obrigatorio seguir imediatamente para
Processo de Concessao.
```

**DECISÃO HUMANA APROVADA**

- A Administração Provisória tem validade de **2 anos**.
- Quando a primeira vence, **NÃO afirmar automaticamente** que ela não pode ser
  renovada.
- Primeiro deve ser **VERIFICADA a possibilidade** de emissão de uma segunda
  Administração Provisória.
- Se essa possibilidade for autorizada, **pode ser emitida** uma segunda
  Administração Provisória.
- Após a emissão da segunda, **será necessária a regularização da Concessão**.
- Administração Provisória **NÃO** deve ser tratada como renovável
  indefinidamente.

```
1a ADMINISTRACAO PROVISORIA
  -> vence
     -> VERIFICAR possibilidade de 2a Administracao Provisoria
        -> se possivel, emitir 2a Administracao Provisoria
           -> depois, regularizacao por Processo de Concessao
```

> **"Verificar possibilidade" é diferente de "segunda Administração Provisória
> garantida".**

## A7. Troca voluntária do Administrador Provisório

**DECISÃO HUMANA APROVADA**

É possível substituir o Administrador Provisório atual por outro familiar
elegível. Para isso:

- o Administrador Provisório atual precisa assinar um **termo de desistência**;
- o termo deve registrar que ele está desistindo **por livre e espontânea
  vontade**;
- somente **depois dessa desistência** o novo Administrador Provisório pode
  assumir, respeitando as regras sucessórias aplicáveis.

## A8. Troca online — GOV.BR

**DECISÃO HUMANA APROVADA**

Quando a troca de Administrador Provisório for realizada online:

- o Administrador Provisório **atual** precisa assinar pelo GOV.BR;
- o **novo** Administrador Provisório também precisa assinar pelo GOV.BR;
- **os dois** precisam conseguir realizar a assinatura digital.

Se qualquer um dos dois não conseguir realizar a assinatura pelo GOV.BR:

```
-> o procedimento devera ser realizado presencialmente na Administracao.
```

## A9. Falecimento do Administrador Provisório

**DECISÃO HUMANA APROVADA**

Caminho **distinto** da desistência voluntária. Se o Administrador Provisório
faleceu:

- **NÃO existe termo de desistência**;
- deve ser apresentada também a **certidão de óbito do Administrador Provisório
  falecido**;
- o jazigo precisa ser **novamente regularizado**;
- deve ser aplicada a **linha sucessória correspondente**;
- deverá ser definido um **novo responsável elegível**.

**Falecimento não é "troca de responsável".**

## A10. Consulta e situação do jazigo

**DECISÃO HUMANA APROVADA** — preserva e reforça regras já consolidadas.

Se o munícipe não souber se o jazigo está recadastrado:

- **NÃO mandar realizar novo Recadastro às cegas**;
- primeiro **verificar a situação cadastral**.

Para localização, reutilizar os meios já consolidados, incluindo quando
aplicável: localização/dados do jazigo; nome do concessionário; nome de pessoa
sepultada.

Isso também se aplica quando o Recadastro for **pré-requisito para outro
processo**, como o Processo de Concessão — caso já representado por
`REL_CONCESSAO_REQUIRES_RECADASTRO` e `REL_CONCESSAO_RECADASTRO_UNKNOWN`.

---

# B) REQUISITOS CONVERSACIONAIS

**Comportamento esperado do robô, derivado das regras acima. Não é decisão
jurídica nem administrativa.**

## B1. Vocabulário — não usar a sigla "AP" com o munícipe

Evitar a sigla **"AP"** em mensagens destinadas ao munícipe. Internamente ela
pode existir se necessário; externamente usar **"Administrador Provisório"** ou
**"Administração Provisória"**.

## B2. Divergência cadastral

Regra de segurança conversacional. Se o munícipe fornecer informação
incompatível com o cadastro — por exemplo *"consta que o concessionário faleceu,
mas ele está vivo"* — o robô:

- **NÃO corrige automaticamente** o cadastro;
- **NÃO escolhe** qual informação é verdadeira;
- **NÃO continua** por uma linha sucessória baseada em informação conflitante;
- **encaminha/trata como divergência cadastral** que precisa ser verificada.

## B3. Controle documental

O atendimento deve distinguir:

- documentos **recebidos e aceitos**;
- documentos **pendentes**;
- documentos **ilegíveis/inadequados**;
- documentos que **deixaram de ser necessários** após mudança de contexto.

Se faltar apenas um documento, pedir **somente o documento faltante**. Não pedir
novamente documentos já aceitos sem motivo.

## B4. Retomada do processo

Se o munícipe interromper o Recadastro e retornar depois, o atendimento deve
preservar, quando aplicável: jazigo identificado; concessionário; situação
cadastral; linha sucessória; Administrador Provisório pretendido; documentos
aceitos; pendências; etapa atual.

**O atendimento NÃO deve começar do zero apenas porque houve interrupção
temporal.**

## B5. Alteração de informação

Quando uma informação estrutural mudar, **recalcular somente o que foi
afetado**:

```
ANTES              concessionario = falecido
                     -> sucessao
                        -> Administracao Provisoria

NOVA INFORMACAO    concessionario = vivo

RESULTADO          -> interromper caminho sucessorio
                   -> NAO criar Administracao Provisoria
                   -> seguir Recadastro de concessionario vivo
```

Preservar informações e documentos que continuarem válidos.

## B6. Múltiplos assuntos

```
PROCESSO EM ANDAMENTO  !=  INTENCAO DA MENSAGEM ATUAL
```

Se o munícipe estiver realizando Recadastro e perguntar sobre outro assunto:
responder ao novo assunto com o conhecimento correspondente; **não apagar** o
estado do Recadastro; preservar documentos e pendências; permitir retomada
posterior.

## B7. Regra central de inteligência

```
INFORMACAO JA CONHECIDA   -> reutilizar
INFORMACAO FALTANTE       -> perguntar
INFORMACAO AMBIGUA        -> esclarecer
INFORMACAO ALTERADA       -> recalcular somente o afetado
DOCUMENTO JA ACEITO       -> nao pedir novamente sem justificativa
PROCESSO INTERROMPIDO     -> preservar estado
```

> **O Recadastro NÃO deve ser implementado futuramente como questionário
> rígido.**

Esta regra é a mesma família do item 2 das decisões de procedimento de
EXUMAÇÃO, e conversa com o contrato **R6** (uma pergunta pendente por turno) sem
se confundir com ele: o R6 diz *quantas* perguntas por turno e *qual primeiro*;
esta diz *o que* perguntar e *o que não* perguntar.

---

# C) GAP / REQUISITO TÉCNICO FUTURO

```
DOMAIN_MODEL_GAP / DECIDED_KNOWLEDGE_AWAITING_FUTURE_IMPLEMENTATION
```

**O conhecimento humano está decidido. O modelo técnico atual é que ainda não o
representa.** Não é decisão pendente; é implementação pendente.

## C1. A Administração Provisória não existe como instrumento no domínio

Hoje, "Administrador Provisório" aparece no domínio **apenas como papel de quem
assina** numa exumação — em `facts.v1.json`
(`exhumation_authorization: OBTIDA_ADMINISTRADOR_PROVISORIO`,
`required_authorization_signatory: RESPONSAVEL_JAZIGO`), em `relations.v1.json`
e em `questions.v1.json`.

**Não existe representação de** Administração Provisória como instrumento com
vigência, titular, ordem (primeira/segunda) ou histórico. Também não existe
representação de linha sucessória, de elegibilidade, nem de conflito familiar.

## C2. Estados conceituais que podem exigir representação futura

Lista **conceitual**, para documentar o gap:

- Administração Provisória vigente;
- Administração Provisória vencida;
- possibilidade de segunda Administração Provisória **pendente de verificação**;
- segunda Administração Provisória emitida;
- desistência voluntária;
- Administrador Provisório falecido;
- divergência cadastral;
- conflito familiar sem responsável definido;
- processo aguardando documentação.

> **Isto NÃO é enum, NÃO é schema e NÃO é código.** Não deve ser transformado em
> nenhum dos três agora, e os nomes acima são ilustrativos do estado, não
> identificadores propostos. A modelagem — quantos campos, quais eixos, o que é
> derivado — é decisão futura.

## C3. `recadastro_status` não cobre estes estados

`recadastro_status` aceita hoje `OK`, `PENDENTE` e `DESCONHECIDO`, com resolução
autoritativa. Nenhum desses três distingue "vencida", "aguardando verificação de
segunda", "em conflito familiar" ou "com divergência cadastral".

**Não presumi que os estados de C2 devam entrar nesse campo.** Podem ser outro
eixo — como no caso de `transport_destination` na EXUMAÇÃO, em que colapsar
eixos diferentes num campo único foi justamente o problema encontrado.

## C4. Requisitos de B3 a B6 dependem de estado persistente

Controle documental, retomada, recálculo por alteração e múltiplos assuntos
pressupõem que o atendimento **preserve estado entre turnos e entre sessões** e
saiba o que continua válido depois de uma mudança. Isso é capacidade da camada de
atendimento, ainda não portada, e não do Gateway.

---

# O que estas decisões NÃO autorizam

- Não autorizam alterar catálogos de domínio, schemas, enums, contratos, vetores
  congelados, referência Python, Gateway TS/Deno ou `release_id`.
- Não autorizam o robô a **escolher** o Administrador Provisório em caso de
  conflito familiar (A4).
- Não autorizam usar a linha lateral havendo sucessor direto aplicável (A5).
- Não autorizam afirmar que a Administração Provisória vencida **não** pode ser
  renovada, nem prometer a segunda como garantida (A6).
- Não autorizam tratar falecimento do Administrador Provisório como troca
  simples (A9).
- Não autorizam corrigir cadastro por informação do munícipe (B2).
- Não autorizam transformar a lista de C2 em enum ou schema.

# Nota sobre a correção de A6

A interpretação corrigida — *"vencida a primeira Administração Provisória, segue
imediatamente para Processo de Concessão"* — **não existe versionada neste
repositório**. Varredura em `docs/`, `santana-conversation-domain/` e
`santana-authority/` não encontra nenhuma afirmação nesse sentido: o domínio só
relaciona Concessão e Recadastro por `REL_CONCESSAO_REQUIRES_RECADASTRO`, que
trata de outra coisa.

Portanto **não há documento versionado a retratar**. A correção fica registrada
aqui como a leitura vigente. Se aquela interpretação existir fora do
repositório, é lá que precisa ser corrigida.

# Fontes canônicas

| | |
| --- | --- |
| Domínio (tópicos, goals, fatos, relações, perguntas) | `santana-conversation-domain/` |
| Regras consolidadas do domínio | `santana-conversation-domain/README.md` |
| Catálogo oficial de EXUMAÇÃO | `santana-authority/catalogo/exumacao.v1.json` |
| Decisões de EXUMAÇÃO do mesmo dia | `docs/decisoes-humanas/2026-08-19-exumacao-*.md` |
| Contratos R1–R6 | `docs/fase2/CONTRATOS-R1-R6.md` |
| Estado operacional do projeto | `docs/HANDOFF-PROJETO-SANTANA.md` |
