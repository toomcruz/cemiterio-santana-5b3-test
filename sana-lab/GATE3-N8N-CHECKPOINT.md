# Gate 3 — checkpoint n8n LAB (24/09/2026)

Branch: `sana-lab-exumacao-f0-f2`. Base da bridge implantada informada pelo usuário: `815f641549a62eaa597fbd4d619ba17f37e09e72`.
Workflow LAB: `m6y2AD8Vx1QZaJiE`, versão final observada `31559c71-6b7f-4edc-a064-55f68515bd01`, ativo: não.

Nós: Manual Trigger → Set sintético → Code adaptador `sana-lab/1` → HTTP Request privado (credencial `7q6AtoIWIwOmx78x`, **desabilitado temporariamente**) → Code validador estrito. Nenhum token literal no JSON dos nós; nenhum webhook/envio/Gemini/W-API.

Execução autenticada controlada: `10299`, erro. A chamada alcançou a bridge interna e recebeu HTTP 401. O diagnóstico do n8n incluiu o cabeçalho Authorization e evidenciou esquema diferente de Bearer. O valor do token NÃO está registrado neste documento. **Rotacionar o token LAB no runtime e corrigir a credencial n8n antes de qualquer nova chamada.** Considerar restringir/remover o acesso aos dados da execução `10299` segundo a política de retenção da instância. Não repetir essa execução.

Testes simulados do validador n8n (não são prova da bridge/engine):
- `10300` 401 → erro LAB_BRIDGE_HTTP_401;
- `10304` 403 → erro LAB_BRIDGE_HTTP_403;
- `10301` 409 → erro LAB_BRIDGE_HTTP_409;
- `10303` 503 → erro LAB_BRIDGE_HTTP_503;
- `10302` resposta não JSON → erro LAB_BRIDGE_NON_JSON;
- `10305` versão incorreta → erro LAB_BRIDGE_INVALID_CONTRACT_VERSION;
- `10306` caso divergente → erro LAB_BRIDGE_INVALID_CASE_ID;
- `10307` campos ausentes → erro LAB_BRIDGE_INVALID_REVISION.

Timeout não foi demonstrado no executor n8n; o nó tem limite configurado de 5 s, sem retry/fallback. Nenhum cenário A–F foi comprovado através do engine pelo n8n. `GATE = BLOCKED`.

Retomada: (1) rotacionar token LAB e corrigir Header Auth; (2) reabilitar apenas nó HTTP LAB; (3) executar um evento sintético NOVO e confirmar 200 + evidência do engine; (4) executar A–F com IDs e revisões; (5) falhas restantes, inclusive timeout; (6) conferir canário sem alteração. Não iniciar Recadastro ou Gemini.
