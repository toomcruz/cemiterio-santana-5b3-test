# Sana — controlador de memória por atendimento (LAB isolado)

**Data:** 18/10/2026  
**Estado:** protótipo executável, testes sintéticos aprovados; **não implantado no OpenBot nem na VPS**.

## Problema confirmado

A ponte em execução (0.4.2) chama `POST /v1/agents/:agentId/messages`, com `text` e `clientMessageId` (idempotência). Esse endpoint usa a conversa principal do agente; não recebe um ID de conversa por munícipe. O OpenBot possui outro contrato (`agent-tasks-v1`) que permite `POST /v1/agent-tasks/start` e `POST /v1/agent-tasks/send`, com `taskId` persistente e um `threadId` próprio. Esses recursos, porém, fazem parte da Team API de um membro autenticado, **não** da API Local Scripts que a ponte usa hoje. Não pressupor que as credenciais e o escopo da ponte dão acesso à Team API.

A conclusão correta não é que a ponte cria automaticamente uma nova conversa por mensagem. Sua conversa principal pode persistir entre mensagens, o que **não isola** cidadãos diferentes.

## Conteúdo

- `session_router.py`: controlador offline com sessões por `lab:<id>`, HMAC para identificar cada escopo sem gravar o contato, TTL de 300 segundos, limpeza limitada de tasks expiradas com estado terminal confirmado, diário de idempotência SQLite, proteção contra resultado desconhecido e estado terminal validado separadamente do HTTP 202.
- `mock_openbot.py`: substituto determinístico de `agent-tasks-v1`, sem HTTP ou acesso a OpenBot.
- `test_lab.py`: testes de continuidade, isolamento, TTL, retorno desconhecido, replay, reinício e armazenamento mínimo.
- `reconciliation.py` e `test_reconciliation.py`: classificação somente leitura de resultados do Boss, sem reenviar ao ver `RESULT_MISSING` e sem presumir `run_id` presente.

Execução local (Python 3.10+):

```sh
python -m unittest -v test_lab test_reconciliation
```

## Portas de segurança — exigidas antes de qualquer integração real

1. **Não enviar tráfego para W-API/Supabase/Dify.** O protótipo só aceita IDs `lab:...` e um transporte `lab_only`. Não tem cliente HTTP.
2. Validar se o OpenBot instalado expõe `agent-tasks-v1` a um operador com credenciais e autorização **próprias**, sem reutilizar o segredo de Local Scripts como se fosse uma sessão administrativa.
3. Verificar se cada task mantém *thread* independente **e** se memórias persistentes, ferramentas, workspace e logs não permitem vazamento de dados de outro munícipe. O OpenBot compartilha algumas dessas superfícies entre tasks do mesmo agente. Isolamento de `threadId` sozinho é insuficiente.
4. Garantir mapeamento `conversation_id` administrativo autorizado → `taskId`/`threadId`, protegido por escopo, com limite de 40 tasks simultâneas no LAB (limite do produto: 50 abertas por agente) e caminho para encaminhamento humano quando cheio.
5. **Nunca confundir ACK com conclusão.** O HTTP 202 não garante resposta ou entrega. `confirm_terminal` só pode receber estado confirmado por leitura autenticada e correlacionada do OpenBot.
6. Ao atingir o TTL com requisição em andamento, bloquear rotação até reconciliar, evitando cancelar um atendimento por engano. Resultado desconhecido bloqueia reenvio automático.
7. Teste real de ponta a ponta deve usar somente contatos/identidades sintéticos, provar não vazamento entre A e B, repetir 3 turnos, expirar após 5 minutos, verificar restart e deduplicação, e exigir auditoria e rollback antes de qualquer mudança em serviços.
8. Corrigir e retestar separadamente o bug da ponte `RESULT_MISSING` e a falha de `reconciliar_tarefa` (`'run_id'`), sem reapresentar resultado ausente como sucesso.

## Referência técnica

Código oficial consultado: `nightly-labs/openbot`, arquivos `docs/automation.md`, `src/backend/agent-service.ts`, `packages/contracts/src/team-protocol/agent-tasks-v1.ts`, `src/main/team-api/route-agent-tasks.ts`. Versão do repositório consultada no momento do diagnóstico: commit `fbe6082f706565aa4b0594758ce931344958e187`. A presença desses contratos upstream **não comprova** sua disponibilidade na versão instalada na VPS.

## Importante

Este pacote **não ativa a Sana**, não altera o perfil do agente, não atualiza nenhum projeto e não realiza chamadas reais. Seu objetivo é validar a lógica antes de integrá-la com autorização correta no LAB da ponte existente, sem conflitar com o outro Work responsável pela atualização multiagente.
