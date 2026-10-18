> SUPERADO APÓS O DIAGNÓSTICO ROOT: consulte STATUS.md. Não aplicar o payload anterior. O retorno direto da Sana foi comprovado; a API de tasks da referência é do desenvolvimento 0.44 e não é exposta pela Team API v0.43.

# Escopo exato da ação root — somente LAB da ponte existente

A autorização do usuário cobre execução LAB com backup. A intervenção é necessária por permissão do sistema operacional, não por nova aprovação de produto.

1. Verificar SHA-256 do próprio payload e hashes dos quatro arquivos ativos. Se divergirem, parar antes de qualquer alteração.
2. Ler somente a execução sintética `1acc093e-de6c-40a5-9c13-1aa004c38e7e`, pela rotina Boss configurada, e sua entrega exata, usando a identidade e os arquivos privados já pertencentes ao serviço OpenBot. Nunca exibir, gravar ou transferir bearer tokens.
3. Exigir resposta real recuperada e marcador `SANA_MEMORY_AUDIT_V1`. Se isso não for comprovado, parar sem instalar.
4. Verificar que a ponte não está no meio de um POST. Execuções remotas e resultados desconhecidos permanecem persistidos, sem reenvio.
5. Criar backup root privado em `/var/backups/openbot-bridge-sana-memory/`, com os quatro módulos e uma cópia SQLite consistente do estado da ponte. Não copiar o banco global do OpenBot.
6. Alterar somente `/opt/openbot-bridge/server.py` e `agent_messages.py`; adicionar `result_adapter.py` e três arquivos de memória em `sana_memory_lab/`. `events.py` e `task_queue.py` continuam intactos.
7. Reiniciar apenas `openbot-bridge.service`; preservar PID do OpenBot, túneis e MCP Santana. Revalidar o retorno da mesma execução. Em falha, restaurar os módulos e reiniciar a ponte; nunca restaurar automaticamente banco por cima de operações novas.
8. Memória permanece desativada. Não criar sessões Team API, credenciais globais, MCPs, agentes, serviços ou contas. Não alterar permissões da Sana, não habilitar canais ou automação.

Sem mudanças em W-API, Supabase, Painel, n8n, atendimento oficial ou webhooks; zero mensagens WhatsApp. A leitura nativa do resultado será comprovada pelo próprio instalador ou a aplicação será interrompida. A sessão Team API e o isolamento completo continuam exigências antes da memória real.
