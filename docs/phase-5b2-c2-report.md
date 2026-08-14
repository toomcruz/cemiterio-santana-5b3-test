# Fase 5B.2-C2 — correções pendentes para reauditoria

Esta versão substitui as interfaces quebradas de feature flags, resolução de sessão e confirmação. Nenhuma migration foi executada. As garantias concorrentes continuam exigindo PostgreSQL real na fase 5B.3, após nova reauditoria estática.

| Achado anterior | Estado desta versão |
|---|---|
| C-01/C-03 | publicação/revogação controladas por RPC `SECURITY DEFINER`, lock de escopo e guard contra publicação direta |
| C-02 | guard agora cobre INSERT/UPDATE/DELETE em conteúdo e links de release final |
| C-04 | classificação persistida, nonce obrigatório e hash calculado no banco |
| C-05/H-01 | persistência de decisão exige envelope fechado e bloqueia A_CONFIRMAR administrativo |
| C-06 | RLS/REVOKE repetidos para tabelas novas e grants documentados |
| H-03 | payload de Reclamação permanece fechado |
| H-04/H-05 | triggers adicionais de escopo e solicitação |
| H-06 | contrato RPC/TS unificado em `p_requested_session_id` |
| H-07/H-08 | SHADOW_ONLY fechado; transporte de modelo removido do classificador |
| H-09 | jobs, locks, geração e outbox implementados sem entrega W-API |
