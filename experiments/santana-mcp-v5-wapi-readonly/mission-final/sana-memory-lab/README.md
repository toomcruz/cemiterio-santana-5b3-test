> SUPERADO APÓS O DIAGNÓSTICO ROOT: consulte STATUS.md. Não aplicar o payload anterior. O retorno direto da Sana foi comprovado; a API de tasks da referência é do desenvolvimento 0.44 e não é exposta pela Team API v0.43.

# Sana: memória por atendimento e retorno de respostas — LAB

Estado: candidato validado offline; ainda não aplicado à ponte ativa. Não pronto para munícipes reais ou ativação automática.

## Evidência atual

- ZIP recebido SHA-256 `f92c46aa7e7f44fa361a9332decc1a5593f1cbc62ac82aea8e2bfc34f4208de0`; manifesto interno íntegro (7 arquivos).
- 18 testes originais reproduzidos. Candidato: 40 testes de memória/contrato/reconciliação, 4 da integração com a ponte, 6 do instalador privilegiado e 13 regressões multiagente existentes: 63 aprovações isoladas.
- Os quatro arquivos da ponte na VPS têm os mesmos hashes de `baseline-bridge/`.
- Falha real reproduzida uma vez: task `d6d8d76dbb344a0a9d70e22acaeee342`, run `1acc093e-de6c-40a5-9c13-1aa004c38e7e`, delivery `8e77a49f-53a0-443b-9667-439e83cf57f2`: OpenBot `succeeded`, ponte sem resultado; uma tentativa, nenhum replay.
- Erro de código confirmado: `_task_reconcile` usa `result['run_id']`, que `_task_result` omitia. Corrigido no candidato.
- Outra limitação confirmada: leitor antigo exige `item_type=final_answer`; o contrato oficial `latestTurnAnswer` admite outros tipos de resposta. O candidato usa primeiro o GET oficial da entrega exata, com correlação de turno e estado terminal. A causa exata do resultado ausente nessa execução ainda depende de comparação autenticada; não presumir a correção comprovada em ambiente real.

## Memória candidata

- TTL de 300 segundos desde o último envio aceito; HMAC por agente e conversa sintética, SQLite persistente sem texto ou telefone.
- Uma task/thread por sessão; aguarda resultado terminal antes do turno seguinte.
- Deduplicação preservada após reinício. Resultado desconhecido bloqueia novo envio; não há replay automático.
- Após expiração, fecha somente task terminal e sem fila. Falha de fechamento bloqueia rotação; limite local conservador de 40 tasks.
- `agent-tasks/start` retorna uma task, não um recibo: o adaptador não inventa messageId/deliveryId.
- Leitura do snapshot exige agente, task, thread, identidade de membro, conteúdo e turno correlacionados. Somente o primeiro input de uma task nova pode estabelecer o delivery pelo snapshot. Perda do recibo de um envio posterior exige recuperação autoritativa do ID; jamais se escolhe por similaridade de texto.
- `TeamTaskTransport` recebe um cliente Team API já autenticado; não cria conta, token, sessão ou serviço, e rejeita credencial Local Scripts como Team API.

## Limites e bloqueios comprovados

O runner é UID 1001, sem sudo autorizado; `/opt/openbot-bridge` pertence ao root e não é gravável. O perfil privado do OpenBot não é acessível ao runner. Por isso nenhuma alteração foi feita à ponte ativa.

A Team API exige sessão de membro e a capability `agent-tasks-v1`. Existência de token Local Scripts ou de root não comprova essa autorização. O cliente Team API real e a segregação das memórias persistentes, ferramentas e workspace da Sana ainda precisam ser verificados. Threads independentes sozinhas não provam esse isolamento.

Os cenários de três turnos, correções, dois contatos, expiração e recuperação estão aprovados com transporte sintético, NÃO com LLM/OpenBot real. A prova real realizada até aqui é a reprodução controlada do erro de retorno.

## Aplicação privilegiada consolidada

`APLICAR-LAB-ROOT.txt` contém uma única execução com SHA-256 fixo do payload preparado pelo runner. Consulte `DEPLOYMENT-SCOPE.md`.

O instalador testa primeiro, com a identidade do serviço OpenBot, a leitura oficial do resultado da execução sintética já existente. Não reenvia tarefa. Se não comprovar o resultado e o marcador, termina sem instalar nada. Se comprovar, faz backup privado do código e do estado da ponte, aplica a correção e reinicia somente `openbot-bridge.service`. O módulo de memória fica instalado e desativado, aguardando Team API e prova de isolamento; não há ferramenta nova de envio ou atendimento automático.

A autenticação Team API e os testes reais são pendências explícitas. Não tratar este pacote como integração concluída.

## Referências oficiais examinadas

`nightly-labs/openbot`, commit `fbe6082f706565aa4b0594758ce931344958e187`:
`packages/contracts/src/team-protocol/agent-tasks-v1.ts`, `src/main/team-api/route-agent-tasks.ts`, `src/backend/agent-service.ts`, `src/main/automation-server.ts`, `packages/contracts/src/ipc-conversation-messages.ts`, `docs/automation.md`.

Nenhuma alteração em W-API, Painel, Supabase, Sana de produção, n8n ou túneis. Nenhum envio WhatsApp.
