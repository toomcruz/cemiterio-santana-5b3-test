# Mapa legado → pacote novo

Esta tabela é de responsabilidade, não de execução. Nada nela modifica o V7.7.

| Origem legada | Responsabilidade observada | Destino 5B.1 | Situação na migração |
|---|---|---|---|
| Nó 5 — Agent | prompt principal, conversa e conhecimento misturados | `support-classifier` + `support-decision-engine` + `support-renderer`; base versionada | migra; Gemini não decide regra |
| Nó 27 — Classificar menu e proteger duplicidade | menu, classificação e proteção de repetição | classificador com estado pré-carregado; sinais técnicos ficam no adaptador futuro | migra em shadow |
| Nós 34–40 | fluxos determinísticos e respostas antigas | `knowledge_*` + `decision_rule` publicados por release | fonte histórica para comparação; não copiar automaticamente |
| Nó 42 — rules context | regras/contexto concorrentes | release + `decision_*` | substituído após comparação |
| Nós 43–45 | aplicar regras e estado | contrato `state.ts`; decision plan; futura fachada de estado | migra gradualmente |
| Nó 46 | preparação de persistência | fachada transacional `support-request-command` | substituído quando validado |
| Nó 47 | persistir/criar solicitação | RPCs novas `propose/confirm/decline` isoladas | fallback temporário somente no legado, sem consulta pelo novo |
| Nó 48 | confirmação | `pending_confirmations`, nonce, hash e validação de versões | migra |
| Nó 52 | rastreio/encerramento | `conversation_sessions`, `inactivity_jobs` e auditoria | migra em shadow |
| Nó 59 | aviso de inatividade | worker 180 s / 120 s, sem W-API nesta fase | substitui lógica concorrente |
| Nó 60 | dossiê de exumação | `knowledge_document_requirement` + `knowledge_asset` + `document_plan` | aguarda publicação de fatos oficiais |
| Nó 61 | fallback/roteamento | classificador + motor; ausência de regra = `A_CONFIRMAR` | substitui fallback factual |
| Nó 69 | perfis/prompt especializado | templates e políticas por release | absorvido pela base nova |
| `support-n8n-gateway` | entrada/saída técnica W-API | futuro adaptador técnico; não mantém conhecimento | permanece simplificado |
| `support-flow-context` | menus/regras/contexto antigos | estado técnico + decisão publicada | absorvido; fonte histórica só leitura |
| `support-rules-context` | leitura de regras antigas | `support_ruleset_release`/`knowledge_*`/`decision_*` | absorvido |
| `support-conversation-state` | sessão, tópicos, confirmações e requests | `conversation_sessions`, tópicos, confirmações e comandos | migra por contrato |
| `support-hybrid-router` | classificação/roteamento concorrente | classificador central + motor de decisão | entra em quarentena futura |
| RPCs/triggers legados | persistência/efeitos do fluxo antigo | RPCs vNext isoladas; legado não é alterado | fallback temporário somente pelo fluxo V7.7 |
| tabelas `service_*` | fatos e regras históricas | comparação, auditoria e curadoria humana | fonte histórica somente leitura; nunca fallback runtime |

## Reclamação

O mapeamento novo é `RECLAMACAO_INTERNA → RECLAMACAO`. Ele não contém gravidade, setor obrigatório, Ouvidoria externa, e-mail automático nem criação sem confirmação.
