# Estado confirmado após o diagnóstico root

O instalador terminou com NATIVE_RESULT_NOT_PROVEN_NO_CHANGE. Nenhum código ativo foi alterado.

## Retorno real comprovado
A Sana respondeu diretamente, pelo MCP instalado, SANA_LAB_RETORNO_OK_20261018. Request d96364dad5e94ceeaada53536e3eb748, delivery 4b72400d-cb80-4290-b023-3e78077887d6: succeeded, result_available=true, uma tentativa. Isso não é um envio WhatsApp e não prova isolamento entre atendimentos.

## Execução antiga
O join exato confirma run 1acc093e-de6c-40a5-9c13-1aa004c38e7e → delivery 8e77a49f-53a0-443b-9667-439e83cf57f2 → turn 01a15138-27ba-77b0-a443-3f3446df1828. Status succeeded/completed, uma mensagem user/routine, zero mensagens assistant. O endpoint oficial também não tem answer. Não existe resposta disponível para recuperar por esse caminho. A causa da ausência de geração não foi comprovada; não atribuir automaticamente a modo silencioso. O run não foi reenviado.

O defeito adicional de reconciliação ('run_id') existe e está corrigido apenas no candidato. Não confundir essa correção com geração de uma resposta inexistente.

## Compatibilidade real
A instalação auditada contém o bundle 0.43.0, que também é a release estável mais recente consultada. Na fonte oficial v0.43.0, o backend possui startTask/readTask/closeTask para uso local, mas a Team API não contém agent-tasks-v1 nem /v1/agent-tasks ou routeAgentTasks. As pastas de protocolos e rotas da release também não têm esse contrato.

A referência inicial fbe6082f706565aa4b0594758ce931344958e187 pertence ao desenvolvimento 0.44.0. A auditoria inicial não havia separado essa referência da release instalada. A comparação agora confirma que o adaptador candidato não pode pressupor a API remota na 0.43. Não é um problema resolvido apenas por root ou novo login.

Fontes:
- https://github.com/nightly-labs/openbot/releases/tag/v0.43.0
- https://github.com/nightly-labs/openbot/blob/v0.43.0/src/main/team-api-server.ts
- https://github.com/nightly-labs/openbot/blob/fbe6082f706565aa4b0594758ce931344958e187/package.json
- https://github.com/nightly-labs/openbot/blob/fbe6082f706565aa4b0594758ce931344958e187/packages/contracts/src/team-protocol/agent-tasks-v1.ts

## Aplicação anterior retirada
Não executar novamente APLICAR-LAB-ROOT.txt nem reinstalar o payload anterior. O gerador e o staging desse payload estão bloqueados. A cópia histórica é preservada para auditoria. Nenhuma nova execução root é solicitada agora.

Os 18 testes originais e 63 testes do candidato/regressões permanecem evidência offline; não provam sessões reais. A memória continua isolada e desativada. Faltam um contrato remoto oficial disponível e autorizado na versão executada e a prova de segregação de ferramentas, workspace e memórias persistentes. Não instalar build de desenvolvimento nem alterar o OpenBot para contornar esse bloqueio dentro desta etapa.

Nenhum envio WhatsApp, alteração de produção, concessão, login, novo serviço ou ativação automática da Sana.
