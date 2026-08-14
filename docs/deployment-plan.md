# Plano de implantação — ainda não executar

## Pré-condição absoluta

Esta Fase 5B.1 termina em revisão de código. Não executar migrations, não publicar Edge Functions, não editar o V7.7 e não criar flags em produção.

## Ordem futura proposta para ambiente isolado

1. Criar um projeto Supabase de teste, sem espelho de dados pessoais de produção.
2. Revisar `database/migrations/0001` e `0002`; confirmar a existência/uso permitido de `extensions.pgcrypto`.
3. Aplicar migrations somente no projeto isolado e executar o seed `database/seeds-test/0001_shadow_test_release.sql`.
4. Publicar as seis funções somente no projeto isolado, com `SUPPORT_VNEXT_MODE=OFF`.
5. Criar a flag global e flags de componente; manter todas `OFF`.
6. Habilitar `support_vnext_global=SHADOW_ONLY` e um único alvo de teste para `new_release_resolver`, `new_classifier_shadow` e `new_decision_shadow`.
7. Rodar testes unitários, shadow e integração; só então usar tráfego sintético sem W-API.
8. Comparar `shadow_comparisons` por amostra revisada, sem resposta ao munícipe.
9. O renderer, request command e worker de inatividade ficam `OFF` até validação específica.

## Proibições mantidas

- Não existe deploy para o projeto produtivo nesta fase.
- Não há chamada W-API no código do pacote.
- Gemini permanece desabilitado sem gateway interno revisado.
- Não há cópia, leitura ou fallback de `service_*` em runtime.
- Não há seed de preços, documentos, prazos, SLAs ou fatos administrativos.

## Critérios mínimos antes de qualquer canário

- revisão SQL e RLS aprovada;
- revisão de segredo e gateway Gemini aprovada;
- testes de confirmação concorrente e inatividade concorrente aprovados em banco isolado;
- taxonomia e release publicada de teste sem itens factuais não confirmados;
- comparação shadow sem divergência crítica não explicada;
- kill switch validado.
