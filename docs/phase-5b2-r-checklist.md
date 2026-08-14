# Checklist 5B.2-R

- [ ] Aplicar somente em banco isolado e executar P01–P15.
- [ ] Validar todas as assinaturas RPC contra PostgREST.
- [ ] Confirmar que nenhum overload antigo continua executável.
- [ ] Inspecionar `SECURITY DEFINER`, `search_path`, RLS e grants com os papéis reais.
- [ ] Testar concorrência de publicação, sessão e confirmação em conexões separadas.
- [ ] Testar `A_CONFIRMAR` no renderer, proposta e confirmação.
- [ ] Testar payload de Reclamação com chaves proibidas aninhadas.
- [ ] Confirmar que flags OFF e ENABLED bloqueiam todas as funções.
- [ ] Revisar conteúdo factual/templates antes de qualquer piloto; este pacote não os fornece.
