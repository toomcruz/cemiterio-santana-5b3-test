# Resultado do trabalho LAB

O candidato está preparado e validado, mas não foi instalado na ponte ativa.

- ZIP íntegro, manifesto 7/7 e 18 testes originais aprovados.
- 63 testes do candidato/regressão aprovados localmente e no runner da VPS.
- Evidência VPS: https://github.com/toomcruz/cemiterio-santana-5b3-test/actions/runs/39175137689
- Todos os PIDs monitorados preservados; nenhum envio WhatsApp, ativação automática ou alteração de produção.
- Falha real reproduzida: OpenBot succeeded, ponte RESULT_MISSING; reconciliação retorna INVALID_ARGUMENT: 'run_id'. Uma única tentativa, sem reenvio.
- A correção usa GET oficial da entrega exata e inclui run_id na resposta da reconciliação. Ainda precisa de prova autenticada na VPS; não está declarada como correção real concluída.
- Bundle desktop identificado como 0.43.0. A inspeção estática não comprovou agent-tasks-v1 no runtime ativo; ausência de strings não é prova de ausência do recurso. O contrato oficial foi auditado, incluindo diferença entre start (task) e send (recibo).
- Memória candidata tem TTL 300s por atendimento e agente, deduplicação persistente, serialização de turnos e bloqueio de resultado desconhecido. Acesso restrito a identificadores LAB sintéticos.
- Três turnos reais, correção real de contexto, dois contatos reais fictícios no OpenBot, expiração real de cinco minutos e recuperação real de falhas ainda NÃO foram executados. Aprovações desses cenários até aqui são offline.

## Intervenção indispensável atual

Runner UID 1001 sem sudo e sem escrita em /opt/openbot-bridge. Executar uma vez o comando de APLICAR-LAB-ROOT.txt como root, já preparado na VPS. O instalador prova a leitura da execução sintética existente antes de qualquer aplicação; se não comprovar, não altera nada. Se comprovar, cria backup privado, aplica o patch e reinicia somente openbot-bridge.service; preserva o OpenBot e túneis. Memória fica desativada, sem credenciais Team API novas ou globais.

SHA-256 do payload: dbbfe50433c183b2e4462266b20bb8ee062c3bd731ea0ebbc7fd15dfb91a9fa0.

Depois será necessário comprovar sessão Team API autorizada e isolamento de ferramentas, workspace e memórias persistentes. Só então executar a bateria real com contatos fictícios. A Sana ainda NÃO está tecnicamente validada para continuidade de atendimento via WhatsApp.
