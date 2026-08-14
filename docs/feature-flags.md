# Feature flags

## Modelo de segurança

São necessários dois níveis ativos para qualquer endpoint:

1. `support_vnext_global` em `SHADOW_ONLY`, com `kill_switch=false`.
2. Flag do componente em `SHADOW_ONLY` para alvo controlado.

O ambiente também precisa de `SUPPORT_VNEXT_MODE=SHADOW_ONLY`. Qualquer divergência deixa o componente desligado.

## Flags iniciais

| Flag | Finalidade | Estado inicial |
|---|---|---|
| `support_vnext_global` | kill switch global | `OFF` |
| `new_release_resolver` | release fixada por sessão | `OFF` |
| `new_state_read` | adaptador futuro de leitura de estado | `OFF` |
| `new_classifier_shadow` | classificação sem efeito | `OFF` |
| `new_decision_shadow` | plano de decisão sem efeito | `OFF` |
| `new_renderer_shadow` | renderização para inspeção | `OFF` |
| `new_request_facade` | comandos isolados de teste | `OFF` |
| `new_inactivity_shadow` | jobs isolados, sem W-API | `OFF` |
| `new_complaint_policy` | política interna de reclamação | `OFF` |
| `new_n8n_adapter` | futura ligação n8n shadow | `OFF` |

Alvos suportados: `PHONE_HASH`, `CONVERSATION_ID`, `SERVICE_CODE`, `COMPONENT`, `RELEASE_ID` e `GLOBAL`. O telefone entra somente como hash; o pacote não persiste número cru para flags.

## Regras

- Um alvo habilitado nunca supera o kill switch global.
- Nenhuma flag concede modo `ENABLED` neste pacote; as funções exigem `SHADOW_ONLY`.
- O adaptador n8n futuro deve resolver o telefone em hash antes da consulta.
- Uma release sem regra resolvida resulta em `A_CONFIRMAR`; não habilita consulta a `service_*`.
