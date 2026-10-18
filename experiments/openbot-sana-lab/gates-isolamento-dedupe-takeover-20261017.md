# Próxima qualificação Sana OpenBot: sessões, idempotência de ingresso, takeover humano

> Escopo: **LAB isolado**. Nenhuma alteração a roteamento W-API, Supabase produtivo, webhook, canal real, Dify ou Painel Santana.

## Progresso real e lacuna

- **Ponte MCP 0.4.2:** envio real ao agente Sana e resposta correlacionada confirmados.
- **MCP deduplicado:** `evidencia-mcp-dedupe-20261017.md` traz prova real de duas tentativas idênticas gerando o mesmo `request_id`, `message_id` e `delivery_id`, com uma resposta recuperada.
- **S15 ingresso WhatsApp:** **NOT_RUN** — não foi exercitado `external_message_id` com o runtime da Sana OpenBot e adaptador de entrada simulado.
- **S16 isolamento:** **BLOCKED** — a ferramenta `enviar_mensagem_agente` recebe `agent_id, message, idempotency_key`, sem identificador de sessão. A API Local Scripts entrega no chat principal do agente, que mantém histórico compartilhado.
- **S17 takeover humano:** **BLOCKED** — nenhuma ferramenta da ponte integra `HUMAN_ACTIVE` com a Sana ou comprova bloqueio da **entrega** de respostas já planejadas.
- O runtime técnico em `santana-conversation-domain/runtime/official_turn_service.ts` já modela `DUPLICATE` e `HUMAN_ACTIVE`, com testes de unidade em `runtime/tests/official_turn_service_test.ts`. Isso não é prova de implantação no runtime da Sana no OpenBot.

## Gatilho para iniciar S16/S17

Criar ou validar **somente no LAB** um ponto de entrada `test_inbound` que admita:

- `lab_contact_id`: identificador sintético estável por munícipe.
- `external_message_id`: identificador estável por mensagem; mesmo ID e conteúdo = uma única ingestão.
- `text`: texto fictício.
- `conversation_id` / `session_id` separado e durável por `lab_contact_id`, resolvido pelo servidor.
- `automation_mode`: `BOT_ACTIVE` ou `HUMAN_ACTIVE`, controlado por evento de operador autenticado, nunca só por texto do contato.
- `reply_delivery_id`/outbox correlacionado, com idempotência de entrega.

O teste não deve usar uma única thread do OpenBot e fingir isolamento por comandos como "ignore a conversa B". Se o OpenBot 0.40 não expuser API suportada para múltiplas threads do **mesmo agente**, **bloquear** e buscar solução autorizada (por exemplo, API de tarefas suportada após revisão) antes de alegar isolamento; não editar o SQLite interno do OpenBot nem instalar 10 agentes permanentes.

## Critérios verificáveis

### S15 — deduplicação do evento de entrada

- Enviar por ingressador simulado `A:m001` duas vezes, com mesmo conteúdo, e checar **um** evento persistido, **uma** interpretação e **um** item de outbox.
- Enviar `A:m002` com texto igual ao anterior e ID distinto: tratar como nova mensagem real, não rejeitar por semelhança textual.
- Repetir `A:m001` com conteúdo diferente: sinalizar conflito e não alterar o histórico silenciosamente.
- Após reinício do adaptador LAB (se aplicável), repetir `A:m001`: sem nova interpretação/entrega.
- Todas as respostas marcadas `S15_PASS` precisam de recibo do ingresso, confirmação de estado e contagens de outbox — **o teste de chave do MCP por si só não é suficiente**.

### S16 — isolamento e memória por contato

- Criar dois contatos fictícios distintos `A` e `B` (p. ex. `5500...`), com `conversation_id` e thread/sessão distintos.
- A informa **jazigo particular** e o nome inventado **Maria Amora**; B informa **Quadra Geral** e o nome inventado **José Palmeira**.
- Alternar perguntas posteriores de A e B; exigir que cada um recupere **somente seus próprios dados**, sem revelar o outro contato, e mantenha contexto do primeiro turno.
- Inspecionar IDs das threads/sessões, não somente a naturalidade do texto; relatar se o modelo foi realmente invocado em sessões distintas.
- Depois do teste A/B, ampliar para 10 contatos fictícios em lotes pequenos para não sobrecarregar a VPS.
- Como requisito, nenhuma mensagem real e nenhum dado pessoal de munícipes.

### S17 — pausa para atendimento humano

- Em A, operador simulado autorizado define `HUMAN_ACTIVE`. Nova mensagem de A deve ser **persistida**, mas **sem resposta automática, LLM disparado ou nova entrega**.
- Um envio automático já pendente em fila deve ser rechecado no momento de entrega; quando takeover ativo, **suprimir** e registrar o motivo.
- O contato B, ainda `BOT_ACTIVE`, permanece funcional (não bloquear globalmente a Sana).
- Ao receber evento autorizado explícito de retomada, A volta a `BOT_ACTIVE` sem reenviar nem responder mensagens já silenciadas.
- Testar duas trocas rápidas de estado e reexecução por IDs estáveis, incluindo falhas e recuperação.

## Passo operacional seguinte

Após relatório de capacidade do OpenBot 0.40 e revisão das APIs suportadas, implementar os contratos **somente em uma implementação isolada LAB**, validar 2 contatos, depois 10, manter W-API real desconectada. Não publicar nem alterar a ponte MCP 0.4.2 instalada sem aprovação de implantação. Antes de declarar `S16_PASS` e `S17_PASS`, trazer `conversation_id`/thread IDs, chamadas, respostas reais, recibos de deduplicação e estados de takeover.
