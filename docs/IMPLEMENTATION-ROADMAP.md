# Roteiro de implementação do Santana

Atualizado em 2026-09-06.

## Decisão de base

`toomcruz/cemiterio-santana-5b3-test` é a base oficial. O repositório
`toomcruz/atendimento-cemiterio-santana` serve somente como referência para
recuperar comportamento útil do painel e aprendizados dos testes anteriores.

## Arquitetura ativa

| Componente | Responsabilidade |
| --- | --- |
| Vercel | aplicação web, painel e rotas HTTP públicas |
| Supabase | PostgreSQL, Auth, Storage, Realtime e Edge Functions quando necessário |
| API do WhatsApp | recebimento e envio de mensagens por integração direta |
| Santana Domain | regras, estado, autoridade, documentos e ações |

O n8n não participa do fluxo de produção.

## Estado auditado

| Área | Estado | Evidência ou pendência |
| --- | --- | --- |
| Motor conversacional | Implementado em modo offline/shadow | testes P0 e runtime no CI |
| Contratos e migrations | Preparados | validar P01–P15 em Supabase isolado |
| Documentos | Implementado no domínio | ciclo explícito, aceitação humana e schema real |
| Ações e acompanhamento | Implementado no domínio | executor por catálogo, transições e vínculo explícito |
| Painel web | Pendente de incorporação | selecionar e adaptar partes úteis do repositório antigo |
| Supabase conectado | Conector disponível | identificar projeto, aplicar somente em ambiente isolado e validar rollback |
| Vercel conectado | Conector disponível | vincular esta base e criar preview após existir aplicação executável |
| WhatsApp | Histórico de testes existe | confirmar provedor/instância, webhook e credenciais em variáveis protegidas |
| Teste ponta a ponta | Pendente | WhatsApp → API → Supabase → resposta → painel |

## Ordem de implantação

1. Tornar o repositório oficial privado antes de incorporar código do projeto
   antigo ou qualquer configuração operacional.
2. Rotacionar credenciais históricas e cadastrar somente as novas chaves nos
   ambientes protegidos do Supabase e da Vercel.
3. Criar um ambiente Supabase isolado, aplicar migrations em ordem e executar
   P01–P15, concorrência e rollback.
4. Incorporar o painel em módulos pequenos, removendo dependências de n8n e
   chamadas antigas.
5. Implementar o adaptador direto da API do WhatsApp com autenticação de
   webhook, idempotência, fila/retry e trilha de auditoria.
6. Publicar preview na Vercel e executar o fluxo ponta a ponta com número de
   teste.
7. Liberar produção por etapas, mantendo modo shadow e rollback disponíveis.

## Critério para produção

Produção exige migrations e rollback comprovados, credenciais rotacionadas,
webhook autenticado, idempotência de mensagens, isolamento por usuário no
painel, logs sem dados sensíveis e um teste ponta a ponta aprovado. Até esses
itens estarem concluídos, `SHADOW_ONLY` permanece como limite operacional.
