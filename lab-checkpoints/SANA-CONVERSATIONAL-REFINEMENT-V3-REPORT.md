# SANA CONVERSATIONAL REFINEMENT V3 — READY FOR HUMAN REVIEW

## Estado

- Branch: `sana-conversational-refinement-v3`
- Base V2 congelada: `bfc6c8335a6c72a401573ec2673f4d77a3dd9b3b`
- Commit V3 LAB: `9f923220adb99a87ba92e31676feadaa722a3482`
- Ciclos usados: 1 de 3
- Gemini: não executado durante o desenvolvimento; custo US$ 0
- Produção alterada: NÃO
- WhatsApp enviado: 0

## Escopo corrigido

- localização de jazigo separada de manutenção;
- protocolo sem número inventado;
- declaração de documento com sujeito/evidência separados;
- HUMAN_REQUEST transfere o controle para espera humana;
- privacidade preservada durante insistência;
- retorno identifica o sujeito quando confirmado;
- mudança de assunto com linguagem cidadã;
- fora da competência com orientação contextual;
- “não sei” com próximo passo útil;
- placa/lápide sem repetir item já conhecido;
- comandos internos não expostos.

## Invariantes

Case isolation, `FOCUS_CASE`, `CLOSE`, `PAUSE_CASE`, `RESUME_CASE`, supersession de correções, fact boundary, autoridade, privacidade, documentos sem validação inventada, reclamação, múltiplos sujeitos, no-request, handoff, receipts/idempotência, atomicidade e no cross-case permaneceram verdes.

## Validação

- Suíte oficial: **407 passed, 0 failed, 1 ignored**
- Regressões V2: **65/65**
- Regressões V3: **56/56**
  - 21 casos dirigidos (10 aprovados V2 + 11 REVISAR/REJEITADOS)
  - 35 inéditos
- Compatibilidade afetada: **68/68**
- Scan de comandos internos: **0 respostas expostas**
- P0/P1 novos: **0**

## Revisão humana V3

Pacote pendente de avaliação humana, sem aprovação automática:

- 11 casos V2 classificados REVISAR/REJEITADOS;
- 5 casos V2 aprovados como amostra de não-regressão;
- comparação V2 → V3 por turno;
- estados compactos antes/depois;
- fatos com valor + evidência;
- eventos, transições, fallback e receipt LAB.

## Arquivos principais alterados

- `santana-conversation-domain/facts.v1.json`
- `santana-conversation-domain/goals.v1.json`
- `santana-conversation-domain/runtime/generated_assets.ts`
- `santana-conversation-domain/runtime/interpreter/deterministic.ts`
- `santana-conversation-domain/runtime/interpreter/bridge.ts`
- `santana-conversation-domain/runtime/reply.ts`
- `santana-conversation-domain/runtime/turn.ts`
- `santana-conversation-domain/runtime/tests/refinement_v2_regression_test.ts`
- `santana-conversation-domain/runtime/tests/refinement_v3_regression_test.ts`

## Artefatos

- `SANA-CONVERSATIONAL-REFINEMENT-V3-HUMAN-REVIEW.md`
- `SANA-CONVERSATIONAL-REFINEMENT-V3-HUMAN-REVIEW.json`
- `refinement-v3-baseline.json`

Este resultado está **READY FOR HUMAN REVIEW**. Não é promoção, publicação, canário nem aprovação humana.
