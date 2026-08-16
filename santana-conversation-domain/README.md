# Santana Conversation Domain v1 (Fase 5B.4-A)

Camada versionada de dominio conversacional do atendimento do Cemiterio Santana.

Escopo desta fase: **modelagem + validacao estatica + P0 determinista**. Sem deploy, sem migration, sem producao, sem
n8n, sem WhatsApp/W-API, sem LLM real, sem alteracao de PostgREST e sem uso do laboratorio Supabase.

## Artefatos

| Arquivo                       | Conteudo                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `topics.v1.json`              | 7 assuntos principais; servicos/subtipos ficam como capacidades, goals ou entidades |
| `goals.v1.json`               | Goals, fatos exigidos, goal stack e semantica dos 5 estados                         |
| `facts.v1.json`               | Fatos, escopo, dominio de valores, origem, dependencias, fronteira IA x regra       |
| `relations.v1.json`           | Pre-requisitos, dependencias, verificacao escopada e overlay de reclamacao          |
| `questions.v1.json`           | Catalogo de perguntas e regra de next best question (6 classes de prioridade)       |
| `conversation-events.v1.json` | 10 eventos conversacionais e seus efeitos                                           |
| `state.schema.json`           | JSON Schema do estado (conversation / case / goal / fact / handoff)                 |
| `engine/`                     | Motor de referencia determinista (sem rede, sem banco, sem IA)                      |
| `tests/p0/`                   | P0 conversacional C01-C16, decisoes humanas D1-D6 e validacao estatica              |

## Separacao conversation / case / goal / fact

- **conversation**: o canal com a pessoa; contem a pilha de objetivos e o log de eventos.
- **case**: o atendimento sobre um sujeito concreto (falecido, concessao, pedido). Fatos com escopo `CASE` pertencem ao
  case e **nunca** sao copiados para outro case.
- **goal**: um objetivo com estados `ACTIVE`, `SUSPENDED`, `WAITING`, `RESOLVED`, `ABANDONED`.
- **fact**: valor com origem, confianca, historico e supersessao.

## 5B.4-A.1 — decisoes humanas fechadas

Fatos **autoritativos** (`authoritative_only`) e valores controlados (`authoritative_values`, `blocking_values`) nunca
sao confirmados por declaracao do usuario, extracao de LLM ou inferencia: ficam registrados como alegacao `UNCERTAIN`, o
objetivo entra em `WAITING` e uma acao pendente e aberta para a Administracao. So `applyAuthoritativeSignal` (origem
`SYSTEM`/`DOCUMENT`) confirma.

| Decisao | Regra                                                                                                  | Acao pendente                             |
| ------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 1       | Destino em jazigo da familia exige verificacao da situacao/dados do jazigo                             | `ACTION_VERIFY_GRAVE_SITUATION`           |
| 2       | Colocacao dos restos exige autorizacao do concessionario ou Administrador Provisorio                   | `ACTION_COLLECT_GRAVE_AUTHORIZATION`      |
| 3       | Recadastro desconhecido: encaminhar verificacao, sem presumir OK nem PENDENTE                          | `ACTION_VERIFY_RECADASTRO`                |
| 4       | `recadastro_status=OK` so por sinal autoritativo de conclusao do Recadastro                            | `ACTION_VERIFY_RECADASTRO`                |
| 5       | `remains_status=EXUMADO` satisfaz a dependencia **no case**, sem proibicao global nem permanente       | —                                         |
| 6       | Conjuge/companheiro vivo assina junto com o responsavel pelo jazigo; sem conjuge, assina o responsavel | `ACTION_COLLECT_EXHUMATION_AUTHORIZATION` |

## Executar

```bash
deno test --allow-read santana-conversation-domain/tests/p0
```

Gate da fase: **P0 = 16/16 PASS** (C01-C16) e **decisoes humanas = 6/6 PASS** (D1-D6), alem dos testes de handoff,
evento social e validacao estatica de catalogos e schema.
