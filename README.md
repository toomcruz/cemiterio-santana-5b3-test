# Santana — base oficial de regras e implementação

Este é o repositório oficial das regras, contratos, estados e comportamento
conversacional do sistema Santana. O n8n não faz parte da arquitetura ativa.

## Produção atual

A aplicação publicada continua no repositório
`toomcruz/atendimento-cemiterio-santana`, pois é nele que hoje vivem o painel e
as rotas conectadas à Vercel. O recebimento e o envio do WhatsApp são diretos
pela W-API; dados, autenticação, armazenamento e funções internas permanecem no
Supabase `SANTANA`.

Portanto, “base oficial” significa autoridade para novas regras e contratos, não
que todo o painel já foi fisicamente copiado para este repositório. Durante a
transição existem dois repositórios com responsabilidades diferentes e apenas
um painel em produção.

A topologia, os limites e o plano de convergência estão em
[`docs/PRODUCTION-TOPOLOGY.md`](docs/PRODUCTION-TOPOLOGY.md).

## Situação desta base

O motor conversacional, os contratos, migrations e testes shadow formam a base
técnica oficial. Os componentes shadow continuam isolados e não foram
promovidos em bloco para o banco de produção. A integração deve ocorrer por
contratos e módulos pequenos, com validação e rollback, sem substituir o painel
operacional de uma só vez.

## Origem do pacote técnico

Este diretório contém código, SQL, contratos e testes **não aplicados**. Ele foi preparado a partir de `Blueprint_Tecnico_Fase_5A_Santana.md`, com as quatro correções vinculantes incorporadas:

1. `automation_mode` é somente `BOT_ACTIVE | HUMAN_ACTIVE`; fechamento é `session.status`.
2. `service_*` é fonte histórica de leitura para auditoria/comparação; nunca fallback runtime.
3. Evidência de modelo é `MODEL_EVIDENCE_SUMMARY`; não existe armazenamento de raciocínio do modelo.
4. `A_CONFIRMAR` bloqueia preço, prazo/SLA, documento obrigatório, proposta administrativa e fallback legado.

Nenhuma migration deste pacote foi executada, e nenhum componente foi publicado ou conectado à API do WhatsApp, Gemini produtivo, `service_*` ou banco existente. Esta versão ainda não está aprovada para tráfego real.

## Estado de validação

- **VALIDADO ESTATICAMENTE**: scripts, contratos, migrations, rollback e CI foram
  revisados localmente; `verify_static.sh` é lint estrutural, não prova PostgreSQL.
- **P01–P15**: prontos para execução em PostgreSQL/Supabase isolado; **não executados**.
- **Deno local**: pendente quando o binário não estiver disponível. O workflow
  `.github/workflows/shadow-static.yml` prepara `fmt`, `lint`, `check` e `test` de
  modo fail-closed; workflow preparado não significa workflow executado.
- **VALIDAÇÃO EM POSTGRESQL**: somente a Fase 5B.3 poderá fornecer essa prova.

## Limite operacional atual

Todos os componentes exigem simultaneamente:

- `SUPPORT_VNEXT_MODE=SHADOW_ONLY`;
- chave interna `x-support-vnext-key`;
- configuração exatamente igual a `SUPPORT_VNEXT_MODE=SHADOW_ONLY`; `ENABLED` falha fechado;
- chave interna `x-support-vnext-key` e permissões de RPC mínimas no banco isolado.

Mesmo nesse modo, não há chamada W-API. O renderer retorna somente contexto/template autorizado e bloqueia Gemini. `service_*` é fonte histórica somente leitura para comparação fora do runtime, nunca fallback. A_CONFIRMAR bloqueia fatos, preço, prazo, SLA, documento obrigatório, proposta administrativa e fallback legado.

## Como revisar localmente

1. Leia `docs/deployment-plan.md` e `docs/security-review.md`.
2. Revise migrations e rollback em ordem numérica, sem executá-los.
3. Execute os testes PostgreSQL P01–P15 somente em ambiente isolado após a reauditoria 5B.2-R.
4. Não promova tráfego real antes de concluir a validação isolada e o teste ponta a ponta.

Os testes TypeScript não fazem chamadas externas. Os testes PostgreSQL de concorrência exigem um Supabase isolado e seguem o procedimento em `tests/integration/concurrency-procedures.md`. O provisionamento de publisher e as modalidades de rollback estão em `docs/isolated-installation.md` e `docs/rollback-plan.md`.
