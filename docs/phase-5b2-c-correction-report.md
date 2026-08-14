# Fase 5B.2-C — correções implementadas para reauditoria

O pacote permanece exclusivamente local e `SUPPORT_VNEXT_MODE=SHADOW_ONLY` é a única configuração aceita. `ENABLED` falha fechado. Não há cliente W-API, webhook n8n, acesso a `service_*`, nem chamada Gemini neste pacote.

| Achado | Correção | Evidência | Regressão |
|---|---|---|---|
| C-01 | Exclusion constraint por escopo/faixa + lock advisory/publicação atômica | 0003 | P01 |
| C-02 | triggers UPDATE/DELETE de conteúdo e fontes vinculadas | 0003 | P02–P05 |
| C-03 | transições limitadas e revogação imutável | 0003 | P06 |
| C-04/H-01/H-02 | autorização inbound persistida; proposta/hash/política/protocolo resolvidos na RPC | 0003–0005, request command | P11–P13 |
| C-05/H-08 | renderer recebe decision_id, relê decisão e bloqueia A_CONFIRMAR/Gemini | 0005, renderer | P10 |
| C-06 | revogação de DML direto e grants somente de RPCs | 0003–0005 | P15 |
| H-03 | payload Reclamação fechado | 0005 | P14 |
| H-04/H-05 | regras filtradas por escopo; conflito vira A_CONFIRMAR; coerência por triggers | 0003, decision engine | P10/P13 |
| H-06 | resolução transacional por RPC | 0004, resolver | P09 |
| H-07 | modo ENABLED removido | security.ts | unit hardening |

Pendentes de prova real: P01, P09, P11 e P15 requerem PostgreSQL isolado com papéis Supabase reais; este pacote não os executou.
