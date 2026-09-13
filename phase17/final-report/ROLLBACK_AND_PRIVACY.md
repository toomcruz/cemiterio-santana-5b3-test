# Rollback, isolamento e privacidade

## Evidência de isolamento

- checkout base permaneceu limpo em `060c795308e18db265d04416de6ae6d25f692f24`;
- desenvolvimento ocorreu apenas no branch `phase16-motor-v2-isolated`;
- nenhuma migration, variável, deploy, webhook, Supabase, WhatsApp, Vercel, painel ou produção foi tocado;
- runners foram executados sem `--allow-net`;
- stores e executores usados são locais/em memória;
- nenhuma nova regra administrativa foi adicionada ao registry do LAB.

## Escopo do diff

O diff contra a base contém apenas:

- `santana-conversation-domain/motor-v2/`;
- `phase17/`.

## Rollback

Rollback é remover o worktree isolado e excluir o branch de desenvolvimento. Não há estado de produção a reverter,
migration a desfazer ou tráfego a restaurar. Os comandos exatos são fornecidos apenas como runbook e não foram
executados.

## Privacidade

- fixtures: sintéticas e previamente validadas na Fase 15;
- hashes e manifestos de fonte conferidos;
- PII, telefones/JIDs, CPF, e-mail, nomes completos, documentos integrais e links sensíveis: ausentes;
- engine outputs: somente conteúdo sintético, identificadores de fixture, hashes, métricas e traces;
- logs/auditoria: conteúdo de entrada representado por hash no adapter atual;
- falha de privacidade é hard guard e invalida a execução.

## Integridade

O pacote final contém um `MANIFEST.sha256`; o ZIP entregue possui hash próprio e permanece privado (`0600`).
