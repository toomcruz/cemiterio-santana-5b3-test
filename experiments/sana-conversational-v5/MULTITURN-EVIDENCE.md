# Evidência de conversas multi-turno — V5 isolada

**Modo:** simulação local; respostas do modelo programadas como scripted-not-gemini.  
**Estado:** initState + officialBridge e planTurn reais do núcleo desta branch; o candidato devolvido num turno é a entrada do turno seguinte.  
**Conhecimento:** nenhum valor ou documento oficial foi alterado. Respostas de composição disponíveis usam marcadores DADO FICTÍCIO DE TESTE; lacuna/conflito também são fixtures identificadas como não oficiais.  
**Baseline:** código da branch com base 5fcba023a4fc461d91e0412fa041ed0669171680; referência de produção, não comparada semanticamente: painel 7d6a33d51b76473a869688b8850a280fcaa1889c, Supabase support-runtime-canary-v4 v19, release sana-consolidation-20260921-v11-e2e. Ver README.

## Conversa encadeada

| Turno e entrada | Estado anterior → posterior | Decisão; resposta do rascunho | Resultado |
|---|---|---|---|
| 1. “Quero exumar meu pai. A companheira está viva.” | Vazio (seq=0) → caso case001, objetivo GOAL_EXUMACAO, fato da companheira VIVO; permanece pendente exhumation_purpose no caso 1. | CONTINUE; “Qual e a finalidade da exumacao?” | **PASS** — fatos e objetivo passaram pelo reducer canônico. |
| 2. “Na verdade, ele não tinha companheira e quais documentos preciso levar?” | Caso 1 com fato VIVO → mesmo caso com INEXISTENTE; regra derivada de signatário atualizada; só exhumation_purpose permanece pendente. | CONTINUE; primeiro aparece “[DADO FICTÍCIO DE TESTE — NÃO É REGRA OFICIAL]”; depois, a pergunta da pendência. | **PASS** — correção aceita; a dúvida é respondida antes da coleta; não pergunta novamente sobre companheira. O texto fictício não é uma lista oficial. |
| 3. “Vou verificar e volto depois.” | Estado do caso 1 antes e depois idêntico (seq=3, fatos e pendência preservados). | PAUSE; “Tudo bem, sem pressa.” | **PASS** — não apaga estado, não repete a pergunta e não pressiona continuação. |
| 4. “Agora é sobre meu tio, quero exumar.” | Caso 1 permanece; novo caso case002 e novo objetivo GOAL_EXUMACAO; pendência associada ao caso 2. | CONTINUE; pergunta do fato pendente do caso 2. | **PASS** — o contexto entregue ao modelo tem zero fatos do caso 1. |

## Critérios fora da coleta

| Entrada e estado anterior | Decisão e resposta | Estado posterior | Resultado |
|---|---|---|---|
| Sem caso, sem fatos e sem pergunta pendente. “Meu pai ficou lá. O que eu faço?” | CLARIFY; “Você se refere ao local onde ele foi sepultado?” | Sem caso ou pendência inventada; estado inalterado. | **PASS** — esclarece ambiguidade sem depender do reducer criar pergunta. |
| Sem caso ou fatos. “Quais documentos?”; fixture NOT_AVAILABLE. | ANSWER; resposta preserva “[TESTE FICTÍCIO — NÃO OFICIAL] Lacuna simulada: fonte não disponível.” | Estado inalterado. | **PASS** — lacuna explícita, sem inventar lista documental. |
| Sem caso ou fatos. “Quais documentos?”; fixture CONFLICT. | ANSWER; resposta preserva “[TESTE FICTÍCIO — NÃO OFICIAL] Conflito simulado: duas versões sem autoridade definida.” | Estado inalterado. | **PASS** — conflito explícito, sem escolher uma versão como oficial. |

Todos os testes acima usam saída de modelo simulada. As execuções bem-sucedidas usam duas respostas programadas por turno, correspondentes às etapas de condução e redação da V5. Isso **não** é medição de latência/custo do Gemini e não demonstra sua qualidade. A comparação de uma e duas chamadas permanece para etapa futura autorizada com Gemini real.
