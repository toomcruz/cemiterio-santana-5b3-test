# Concessão/Titularidade — fontes e limites LAB

Inventário direcionado no checkout da branch `sana-lab-exumacao-f0-f2` em 2026-09-24. Autoridade de catálogo de domínio não é autorização de operação administrativa nem comprovação de vigência de um termo. A vertical canônica é `sana-lab/concessao_titularidade.ts`, chamada por `sana-lab/engine.ts`; bridge e n8n apenas transportam e validam.

| Fonte | Assunto | Autoridade e vigência/confiança | Uso | Lacuna |
| --- | --- | --- | --- | --- |
| `santana-conversation-domain/goals.v1.json` (`GOAL_CONCESSAO`) | Caso por concessão; finalidade, referência, documento do solicitante e situação de Recadastro | Domínio versionado v1, fase 5B.4-A; não é procedimento oficial vigente | REUTILIZAR para separação do caso e coleta declarativa | Critério real de concessão nova, transferência, renovação e decisão final |
| `santana-conversation-domain/facts.v1.json` | `concession_purpose` permite NOVA/TRANSFERENCIA/RENOVACAO; `recadastro_status=OK` requer fonte autoritativa SYSTEM/DOCUMENT | Regra de integridade do domínio v1; requisito documental específico não homologado aqui | REUTILIZAR enum e veto à inferência de OK; ADAPTAR relato de outra modalidade como relato livre, não enum oficial | Evidência autorizada de Recadastro, legitimidade e representação |
| `santana-conversation-domain/questions.v1.json` | Perguntas de modalidade, referência, Recadastro e documento do solicitante | Perguntas de domínio v1; não indicam documentação aprovada | REUTILIZAR apenas perguntas pertinentes, uma pendência por vez | Lista aplicável por modalidade e por representante |
| `santana-conversation-domain/relations.v1.json` | Recadastro PENDENTE condiciona Concessão; DESCONHECIDO exige verificação, sem presumir OK | Domínio v1, decisões 5B.4-A.1; relações dependem de status autoritativo por caso | ADAPTAR: mostrar pendência e aceitar vínculo explícito; nunca abrir automaticamente Recadastro ou tratar seu rascunho como OK | Serviço real de verificação e vínculo por concessão |
| `santana-conversation-domain/topics.v1.json` | `CONCESSAO` possui nova/transferência/renovação, mas `RECADASTRO` ainda rotula `ATUALIZACAO_TITULARIDADE` | Taxonomia histórica v1 com `deployment: NONE`; conflito de escopo com a decisão atual | ADAPTAR o tópico CONCESSAO; NÃO USAR o rótulo antigo de Recadastro como autorização para transferência | Revisão da taxonomia quando o domínio oficial for atualizado |
| `santana-conversation-domain/tests/p0/administrative_integrity_test.ts` e `runtime/tests/official_journey_integration_test.ts` | Status por caso, correção de referência, verificação e separação de Recadastro | Evidência histórica de outro runtime/estado; não é integração atual nem autoridade para decidir direitos | REUTILIZAR como padrões de isolamento e integridade, sem executar comandos oficiais | Vínculo do runtime anterior com a bridge LAB, se vier a ser aprovado |
| Documentos operacionais, termos, regras aprovadas e jornada específica de Concessão | Busca direcionada por concessão/titularidade/renovação/sucessão/representação | Não foi localizada neste checkout fonte específica vigente que determine documentação e legitimidade por modalidade | NÃO USAR inferência de Exumação ou termos não localizados | Obter fonte oficial vigente, critérios de sucessão/representação/disputa, prazos e canal de decisão |

## Comportamento e operações

- Consulta informativa: explica as três modalidades declaradas pelo domínio, sem abrir caso operacional ou prometer direito; pode concluir **somente a orientação informativa**.
- Início: pede modalidade quando ausente; cria no máximo `REGISTER_CONCESSAO_DRAFT` LAB quando existe intenção explícita e modalidade ou outra situação descrita. Rascunho fica em `WAITING_CITIZEN` e não conclui concessão.
- Referência e correção: declaração no caso atual, com histórico; divergência sem correção explícita pede esclarecimento em vez de trocar o jazigo.
- Documentos: apenas referências sintéticas `RECEIVED_UNVERIFIED`. Nem o arquivo nem a referência validam solicitante, titular ou direito.
- Recadastro: dependência contextual do processo. Caso distinto pode ser vinculado explicitamente; nenhum dado ou status OK migra por semelhança de conversa, texto ou número.
- Acompanhamento e encerramento: só estado LAB; pedido ainda pendente continua aberto mesmo com conversa encerrada. Pedido explícito de humano ou disputa declarada fundamenta exceção transversal, sem tarefa real.

Lacunas bloqueiam **aprovação e operação oficial**, não a orientação, coleta segura, correção, acompanhamento ou simulação. `UNKNOWN` não cria encaminhamento genérico. Nenhuma concessão é APROVADA, TRANSFERIDA, RENOVADA, DEFERIDA ou REGULARIZADA por fatos declarados ou documento recebido.
