# Revisão do pacote `Sana-LAB-S15-S17-20261017.zip` — 17/10/2026

**Escopo**: cópia de laboratório isolada, sem integração de produção. Revisão feita após relato do Work, usando arquivo do projeto WhatsApp Santana.

## Evidência reproduzida

- ZIP examinado: 7 arquivos, sem erros de integridade ao abrir.
- SHA256 do ZIP lido neste ambiente: `9ad9c14326c008aab40e46fe8690e4980b38b11c8387c56348aa1e989d6544a0`.
- `SHA256SUMS` interno: **6/6 OK**.
- `controller.py`: `fcb080a3f8007a55bbc8727834f140d2dcd65376f17ccb90ac3a50001e7a9088`.
- `test_controller.py`: `f3fa873c55555cc012c5b8a19a59b8ccc9a31816e67f65b4659fc295b7607af3`.
- Comando independente: `python3 -m unittest -v test_controller.py test_review.py`.
- Resultado: **9 testes aprovados**, **0 falhas**, no ambiente isolado.
- Implementação observada: `FakeLLM` para inferência; SQLite para recebimento/estado/outbox e `fcntl.flock` para posse exclusiva de banco. Não há transporte W-API e não foi criado qualquer thread nativo da Sana.

## Correspondência correta dos nomes no projeto

O relatório do Work nomeou a busca por **sessões** como S15 e a **deduplicação** como S16, mas o catálogo versionado deste repositório já define:

| ID oficial do LAB | Assunto | Situação evidenciada por este pacote |
|---|---|---|
| S15 | Deduplicação de entrada | **PASS_LOCAL** no controlador SQLite; **não** comprova W-API/runtime real |
| S16 | Isolamento de munícipes | **BLOCKED**; nenhum `session_id` ou `thread_id` real |
| S17 | Pausa humana | **PASS_LOCAL** na simulação por contato; sem operador autenticado, sem dispatcher de WhatsApp |

**Não** promover qualquer cenário como E2E PASS. `sent: true` significa que a saída foi gravada na **outbox local**, não enviada.

## Pista técnica sobre o OpenBot 0.42.0

A [documentação da versão 0.42.0](https://github.com/nightly-labs/openbot/blob/v0.42.0/docs/architecture/agents.md) descreve tarefas nativas com conversas, filas e provider threads **independentes** por tarefa, abertas na interface ("New task") ou por ferramenta `openbot.start_task`. Também declara: **"The Team API has no task route"**. A [API Local Scripts 0.42](https://github.com/nightly-labs/openbot/blob/v0.42.0/docs/automation.md) aceita `POST /v1/agents/:agentId/messages`, mas não recebe `task_id`/identificador de thread.

Isso **não** elimina o bloqueio: a ponte ChatGPT→Sana atualmente endereça o chat principal. A existência de tarefas nativas é uma via a explorar no LAB, sem confundi-la com sessão de munícipe já roteável por MCP ou W-API.

**Próximo experimento mínimo**: verificar via interface ou ferramenta nativa autorizada se a Sana pode iniciar e continuar duas tarefas distintas (`A` e `B`) com resposta real do LLM, capturar seus IDs e demonstrar isolamento por pergunta cruzada. As tarefas partilham o workspace do agente; portanto, observar isolamento de histórico não prova segregação de arquivos, memórias ou dados. Não criar dez tarefas antes de comprovar duas e não modificar o banco SQLite do OpenBot.

## Segurança

A revisão não instalou código na VPS, não modificou a ponte MCP ou OpenBot, não enviou WhatsApp e não acessou dados reais. Este documento não autoriza publicação nem mudança do canal oficial.
