# SANA SIMULATION LAB — PARTIAL

O laboratório foi executado no runtime oficial da Sana, em branch/worktree isolado, com transporte sintético e outbox QUEUE_ONLY. A parte determinística está verde; a validação primária Gemini ficou parcial por quota 429.

## 1. TOTAL

- Atendimentos finais: **60** (50 desenvolvimento + 10 inéditos).
- Turnos finais: **177** (147 + 30).
- Chamadas Gemini nos lotes finais: **171** (141 no lote de 50 + 30 inéditas).
- Chamadas Gemini com HTTP 200: **23/171**; `llm_valid`: **5**; `fallback_invalid`: **18**; `fallback_error/PROVIDER_QUOTA`: **148**.
- Custo estimado dos lotes Gemini finais: **US$ 0,0058083**; abaixo do limite autorizado de US$ 2,00. As chamadas exploratórias anteriores totalizaram 493 chamadas e aproximadamente US$ 0,0311.
- Tempo total: registrado por artefato em `telemetry.elapsed_ms` de cada execução; nenhum processo ficou ativo ao final.

## 2. BASELINE

- Desenvolvimento baseline: **41/50 sem falha**, **9/50 com falha**, 147 turnos.
- Principais problemas: boundary de fatos/evidência, lifecycle CLOSE/RESUME/FOCUS, correções e alegação de handoff sem receipt.
- Suite oficial baseline: **286 passed, 0 failed, 1 ignored**.

## 3. CORREÇÕES

- Correções LAB-only: **6 áreas de código + harness/avaliador**.
- Componentes: `engine.ts`, `conversation_controls.ts`, `deterministic.ts`, `bridge.ts`, `reply.ts`, `citizen.ts`, `evaluator.ts` e cenários/regressões.
- Checkpoints: `lab-checkpoints/phase-0-baseline.json`, `simulation/checkpoints/phase-1-harness.json`, `cycle-1-pre-fix.json`, `cycle-2-pre-fix.json`.
- Não houve merge, publicação, migration, alteração de Edge/Gateway/Supabase/W-API ou WhatsApp.

## 4. RESULTADO FINAL

- Lote determinístico final: **50/50**, 147 turnos, 0 falhas.
- Anti-overfitting determinístico: **10/10**, 30 turnos, 0 falhas.
- Regressões LAB: **6/6**.
- Suite oficial: **286 passed, 0 failed, 1 ignored**.
- P0/P1 determinísticos: **0 falhas finais**.
- Melhora quantitativa: **9 falhas → 0** no lote de desenvolvimento; **1 falha → 0** no último lote anti-overfitting após correção de “vó”/correção explícita.
- Gemini: o fallback seguro preservou 0 falhas avaliadas, mas a quota impediu provar o caminho primário em todos os turnos. Não declarar o gate Gemini completo.

## 5. PRINCIPAIS FALHAS ENCONTRADAS

1. lifecycle de fechamento/retomada não observável no fluxo natural;
2. foco/retorno a caso anterior sem transição explícita;
3. fronteira entre valor catalogado e evidência textual;
4. correção de referência sem marcador semântico suficiente;
5. vocabulário coloquial (`vó`) tratado como ambiguidade;
6. clarificação expondo enum interno;
7. repetição de pergunta após referência já coletada;
8. simulador substituindo correções planejadas pela verdade oculta;
9. falso positivo do avaliador para alegação de handoff;
10. divergência do source cut: não existe etapa separada de draft Gemini.

## 6. PENDÊNCIAS

- **Quota Gemini:** repetir a matriz primária completa quando houver quota, sem alterar prompt/schema no meio da rodada. Nenhuma nova chamada foi feita após a identificação dos 429.
- A resposta final do source cut é determinística; se uma etapa de draft Gemini for requisito de uma futura candidata, ela precisa ser tratada como mudança de escopo e não como resultado deste laboratório.

## 7. PRODUÇÃO

**PRODUCTION CHANGES: NONE**  
**WHATSAPP MESSAGES SENT: 0**

Todos os runs reportam `production_changed=false` e `whatsapp_sent=0`. Nenhum número real, PII, Gateway, W-API, Edge, Supabase de produção ou configuração global foi tocado.

## 8. RECOMENDAÇÃO

**READY FOR HUMAN REVIEW** para as correções LAB-only e os resultados determinísticos.  
**NOT READY FOR CANARY** até repetir a validação primária Gemini sem quota-stop.

Artefatos principais:

- `simulation/runs/final-deterministic-v7.json`
- `simulation/runs/novel-deterministic-v5.json`
- `simulation/runs/final-gemini.json`
- `simulation/runs/novel-gemini-10.json`
- `simulation/reports/triage.md`
