# Checklist objetivo — Fase 5B.2: revisão técnica

- [ ] Confirmar que nenhum migration toca schema/tabelas/RPCs/triggers legados.
- [ ] Revisar todas as constraints de `A_CONFIRMAR`, Reclamação e confirmação explícita.
- [ ] Confirmar que `automation_mode` não contém `CLOSED` e que fechamento é de sessão.
- [ ] Revisar RLS, grants, secrets e chave interna; validar kill switch global.
- [ ] Validar imutabilidade de release, conteúdo publicado, proposta, payload e protocolo.
- [ ] Validar `EXPLICIT_REBIND` contra release revogada e replacement publicado.
- [ ] Executar testes unitários e shadow em runner Deno isolado.
- [ ] Executar cenários PostgreSQL de concorrência: dois “sim”; tópico mudado antes de confirmar; nova mensagem versus fechamento.
- [ ] Confirmar que o worker não chama W-API e que fechamento não gera mensagem final.
- [ ] Confirmar que nenhuma função consulta `service_*` em runtime.
- [ ] Revisar todos os pontos `A_CONFIRMAR` e as dependências de gateway Gemini/n8n.
- [ ] Revisar documentação de deploy/rollback e confirmar que nada será aplicado em produção.
- [ ] Aprovar somente então uma aplicação em ambiente isolado; não habilitar tráfego real.
