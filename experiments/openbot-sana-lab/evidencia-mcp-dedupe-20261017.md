# Teste real de idempotência do MCP ChatGPT → Sana — 17/10/2026

> Escopo: ponte OpenBot **0.4.2-direct-agent-messages-candidate**, usando **Local Scripts** em localhost da VPS. O teste não envolve transporte WhatsApp/W-API, painel, Dify, Supabase nem dados reais.

## Ação executada

O ChatGPT chamou **duas vezes** a ferramenta MCP `enviar_mensagem_agente` com os mesmos parâmetros:

- `agent_id`: `agent-463cb080-75d4-4371-b3d5-552fc9a435e5` (Sana)
- `idempotency_key`: `sana_lab_20261017_idempotencia_chatgpt001`
- Texto: `TESTE INTERNO DE IDEMPOTÊNCIA DA PONTE MCP. Isto não é um atendimento nem uma mensagem de WhatsApp. Não utilize ferramentas, não consulte sistemas, não faça encaminhamentos. Responda somente: SANA_IDEMPOTENCIA_OK.`

As duas chamadas devolveram exatamente:

- `request_id`: `a29b58191ac1455cb98e7fadb0c143d5`
- `message_id`: `d005b89e-1acc-405a-b7a9-d65b8c29f4bf`
- `delivery_id`: `1b52eff3-ea6e-4379-aaa2-c5c83f09358c`
- Primeiro estado: `accepted`

Uma consulta posterior à ferramenta MCP `consultar_execucao_agente` mostrou `state: succeeded`, `result_available: true`. A ferramenta `obter_resposta_agente` retornou a resposta final correlacionada por entrega:

```text
SANA_IDEMPOTENCIA_OK
```

## Resultado

**MCP_BRIDGE_IDEMPOTENCY_PASS**: duas tentativas com a mesma chave, agente e texto resultaram em **uma mesma solicitação lógica, mensagem e entrega**, sem observação de uma segunda entrega. A resposta efetiva foi recuperada e não houve envio ao WhatsApp.

**Não é S15 PASS do runtime do WhatsApp.** A duplicidade de eventos recebidos via W-API e as garantias de outbox do runtime oficial não foram exercitadas por estas duas chamadas.

## Limitações e próximos portões

- O teste ocorreu depois que a ponte multiagente foi instalada e expôs as três novas ferramentas; **não** mediu concorrência real de duas requisições HTTP simultâneas (esse comportamento tem teste sintético na ponte, mas não foi repetido na VPS).
- A ponte MCP só recebe `agent_id`, `message`, `idempotency_key`; **não aceita `contact_id`, `conversation_id` ou `task_id`**. Todas as mensagens diretas vão para o chat normal do agente Sana. Isso **não comprova isolamento entre 10 munícipes**.
- O runtime técnico oficial no repositório possui caminhos `DUPLICATE` e `HUMAN_ACTIVE` e testes próprios, mas isso não comprova integração da Sana do OpenBot, pausa humana no painel atual ou não duplicidade do WhatsApp real.
- S16 (isolamento) e S17 (takeover humano) continuam bloqueados até existir um adaptador isolado de teste com sessões independentes e bloqueio de resposta na entrega.
- Nenhuma alteração de produção, W-API, Supabase, OpenBot ou VPS foi feita por este documento.
