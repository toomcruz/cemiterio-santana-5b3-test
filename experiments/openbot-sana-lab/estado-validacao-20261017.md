# Sana OpenBot LAB — consolidação da avaliação até 17/10/2026

**Natureza da evidência:** informações relatadas pelo usuário, transmitidas pelos agentes Sana e Munícipe de Teste, com o relatório completo preservado **localmente no OpenBot** em `/var/lib/openbot/OpenBot/Agents/agent-463cb080-75d4-4371-b3d5-552fc9a435e5/RELATORIO-TESTES-SANA-S01-S14.md`. Este arquivo **não** foi lido nem incorporado a este commit. Não atribuir verificação independente de transcrições ou IDs à revisão GitHub.

## Estado relatado

| Escopo | Resultado comunicado | O que comprova / não comprova |
| --- | --- | --- |
| S01–S04 | Quatro cenários executados, sem novos erros de conteúdo informados | Conteúdo conversacional entre agentes, não transporte de WhatsApp |
| S05–S08 | Conteúdo sem falhas pendentes após revisão; `FLOW_PASS` relatado na nova rodada | IDs de respostas correlacionadas antes dos envios seguintes, **sem timestamps independentes** |
| S09–S10 | Repetição revisada como não falha efetiva; `FLOW_PASS` relatado | Perguntar nome completo quando **ainda não fornecido** é necessário; se fornecido, não repetir |
| S11–S14 | Conteúdo aprovado nos relatos originais | Não provar ordem por IDs para estes cenários nesta revisão |
| S15–S17 | Não executados | Não há validação de idempotência/duplicidade, isolamento entre munícipes, pausa humana e integração com runtime |

**Síntese de conteúdo:** os agentes reportaram **14 cenários sem falhas de conteúdo remanescentes** após revisão do S05 e S09–S10. Isso é um status de QA **relatado**, não certificação independente de todas as transcrições.

**Síntese de sequência:** `FLOW_PASS` **relatado** para S05–S10. A correlação efetiva por IDs pode comprovar ordem lógica mesmo sem timestamp independente. Os IDs e a cadeia causal de cada turno não foram auditados neste commit.

**Isolamento:** não comprovado. As conversas de cenário ocorreram com histórico compartilhado entre agentes; o mesmo histórico pode contaminar respostas de casos diferentes. Não declarar `ISOLATION_PASS`.

## Decisão de avaliação do S05

A primeira mensagem, **“Quero exumar da Quadra Geral.”**, indica o início de uma **solicitação efetiva**. Se o parentesco ainda é desconhecido, a Sana **pode perguntar** o grau de parentesco para orientar a solicitação. Isso **não** deve ser marcado como erro.

Se a mensagem do cidadão fosse apenas **“Quanto custa a exumação?”**, a Sana deveria responder objetivamente à pergunta informativa sem impor triagem como pré-condição.

## Próxima fase — ainda não executada

Parar de repetir baterias de conteúdo já concluídas. Desenhar e validar **ambiente isolado com conversas independentes** e controle de sequência, sem conectar o OpenBot Sana à W-API real ou à produção. Executar S15–S17 no runtime de testes antes de qualquer proposta de corte para atendimento público.

**Risco tarifário não encerrado:** referências operacionais de preço de LAB continuam pendentes de conciliação com a fonte oficial para uso em produção.

## Retificação de regra de parentesco (posterior ao relatório S01–S14)

O responsável corrigiu a interpretação anterior: **cônjuge/companheiro(a) e filhos(as) possuem o mesmo direito familiar de solicitar exumação; o(a) cônjuge não tem prioridade automática**. A presença de cônjuge vivo não impede que um(a) filho(a) **inicie o pedido**.

Os casos S07 e S08 foram modificados para testar explicitamente a nova regra e **ainda não foram reexecutados sob esse critério**. A aprovação de conteúdo relatada anteriormente permanece histórica, mas não valida a nova exigência.

As regras atuais em `santana-authority/catalogo/exumacao.v1.json` e `santana-conversation-domain/facts.v1.json` sobre assinatura de cônjuge vivo divergem do enfoque de igualdade de legitimidade familiar e exigem conciliação administrativa antes de produção. A análise de quem assina pelo jazigo é **distinta** de quem pode solicitar.

**Nenhum deploy, webhook, perfil OpenBot, WhatsApp, Supabase produtivo ou catálogo autoritativo alterado por esta consolidação.**
