# Sana Simulation Lab — triagem por causa-raiz

## Baseline

- Runtime oficial antes das correções: 50 atendimentos, 147 turnos, 9 conversas com falha determinística.
- Suite oficial antes das correções: 286 passed, 0 failed, 1 ignored.
- Falhas agrupadas:
  - **Fact boundary / evidência:** sim-07, sim-18, sim-22, sim-46. Valores catalogados eram avaliados como se fossem fatos inventados quando a evidência textual apenas variava em acento/contexto.
  - **CLOSE/RESUME/FOCUS:** sim-08, sim-19, sim-20, sim-30. Fechamento/retomada e retorno ao caso anterior não chegavam ao reducer oficial como transições observáveis.
  - **Handoff:** sim-40. O avaliador detectava alegação em texto composto sem receipt, embora não houvesse handoff persistido.
  - **Correção:** sim-12/sim-13 expuseram, durante a execução, marcador de correção incompleto; sim-12 era interferência do simulador, sim-13 era interpretação real de “a quadra ... estava errada”.

## Correções LAB-only

1. `conversation_controls.ts`: retorno, fechamento natural e negação mais robustos.
2. `deterministic.ts`: mudança explícita de tópico, correção sem novo valor, inferência segura de parentesco e reconhecimento coloquial de “vó”.
3. `engine.ts`: foco de caso e suspensão/reativação pelo reducer oficial.
4. `bridge.ts`: linguagem cidadã sem enums internos e eventos de lifecycle observáveis.
5. `reply.ts`: coleta de ocorrência sem repetir referência já conhecida.
6. `citizen.ts`/`evaluator.ts`: simulador preserva correções planejadas; avaliador independente separa evidência de valor e não acusa falso positivo por enum canônico.

## Ciclos

| Corte | Conversas | Turnos | Falhas |
|---|---:|---:|---:|
| baseline | 50 | 147 | 9 |
| ciclo 1c | 50 | 147 | 4 |
| ciclo 2f | 50 | 147 | 1 |
| final determinístico | 50 | 147 | 0 |
| anti-overfitting determinístico | 10 | 30 | 0 |

Não houve ciclo adicional após o terceiro limite lógico; o último ajuste foi uma correção de interpretação e sua regressão, seguido de lote completo.

## Evidência

- Transcrições, estados antes/depois, eventos, receipts e outbox estão nos JSON em `simulation/runs/`.
- Transporte substituído apenas por `LabStore`/outbox QUEUE_ONLY; nenhum envio externo.
- O corte congelado não possui uma segunda etapa de draft Gemini: a resposta cidadã é o renderer determinístico oficial do source cut. Isso é divergência documentada, não mascarada.
