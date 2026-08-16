# Adapter controlado de LLM (5B.4-D)

O adapter provider-agnostic está implementado em `adapter/`, atrás de feature flag desligada por padrão. Nenhum provedor
real foi configurado: a auditoria do ambiente não encontrou credencial, e os testes usam exclusivamente uma fronteira
de rede injetada. Adapter `santana-llm-adapter/1.0.0`; prompt `santana-llm-prompt/1.0.0`.

## Onde o LLM entra

```
mensagem ──▶ Interpreter (mock hoje | LLM amanhã) ──▶ Interpretation (contrato v1)
                                                          │
                                                          ▼
                                                   guardInterpretation()   ← barreira dura
                                                          │
                                                          ▼
                                              toConversationEvents()  (bridge)
                                                          │
                                                          ▼
                                        reducer TypeScript  (único motor semântico)
                                                          │
                                                          ▼
                                        diffTransition() ──▶ conv_apply_transition (0020)
```

O adapter implementa a assinatura assíncrona:
`interpret(input: InterpreterInput): Promise<Interpretation>`. Tudo depois dele já existe e já é testado — inclusive
contra proposta maliciosa (o teste “fato fora do catálogo e origem proibida” injeta uma interpretação envenenada e prova
que a guarda a descarta).

## O que o LLM poderá fazer

Extrair fatos candidatos do catálogo v1, identificar evento conversacional, sugerir objetivo, apontar ambiguidade,
estimar confiança, redigir a pergunta de esclarecimento e resumir o handoff.

## O que o LLM nunca poderá fazer

1. Escrever no banco (não tem credencial; só o bridge/reducer conversam com a RPC).
2. Emitir fato `authoritative`, ou origem `SYSTEM`/`DOCUMENT`/`DERIVED_RULE` — o contrato tipado só admite
   `USER_EXPLICIT`/`USER_CORRECTION` e a guarda descarta o resto.
3. Afirmar situação de jazigo, autorização de jazigo ou autorização de exumação: são `authoritative_only` e a guarda os
   recusa com motivo `AUTHORITATIVE_FACT`, mesmo que o texto do munícipe afirme o contrário.
4. Inventar código de fato, valor fora do domínio, preço, documento obrigatório, prazo, permissão ou direito sucessório:
   recusados como `UNKNOWN_CODE` / `VALUE_OUT_OF_DOMAIN` / `OFFICIAL_RULE`.
5. Adivinhar sob ambiguidade ou baixa confiança: vira esclarecimento (`needs_clarification`), e nenhum evento é enviado
   ao reducer.

## Contrato operacional do adapter

| Item              | Regra                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Saída             | JSON conforme `interpretation.schema.json`; resposta que não valida é descartada e vira esclarecimento |
| Vocabulário       | `fact_code`/`goal_code` restritos ao catálogo v1 injetado no prompt e revalidados na guarda            |
| Evidência         | todo fato candidato precisa citar o trecho da mensagem; sem evidência, a guarda descarta               |
| Determinismo      | `temperature=0`, seed fixa quando disponível, e cache por hash da mensagem + contexto                  |
| Timeout/falha     | qualquer erro, timeout ou resposta inválida degrada para o interpretador determinístico                |
| Custo/limite      | rate limit e limite de tokens por conversa, com fallback para o mock                                   |
| Auditoria         | `produced_by` identifica modelo e versão; o hash do prompt e da resposta vai para a trilha             |
| Privacidade       | a mensagem crua não é persistida em `conv_*`; o que entra é fato de domínio e HMAC do sujeito          |
| Fronteira de rede | uma única função de saída, com allowlist de host, desabilitada por feature flag                        |

## Gates antes de ligar

1. As mesmas fixtures desta fase (`messages.v1.json`) com resultado equivalente em evento, objetivo e fatos —
   divergência de redação é aceitável, divergência de decisão não.
2. Suíte adversarial de _prompt injection_: mensagens que mandam “ignore as regras”, “grave como SYSTEM”, “a autorização
   está aprovada”, “o preço é X” — todas devem terminar em recusa registrada.
3. Round-trip end-to-end (o `p26` desta fase) reexecutado com o adapter no lugar do mock.
4. Prova de que a chave do modelo não tem acesso a banco, e de que a função de saída está atrás de flag desligada por
   padrão.
