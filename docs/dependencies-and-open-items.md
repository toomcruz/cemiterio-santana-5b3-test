# Dependências e itens A_CONFIRMAR

## Dependências técnicas

- Supabase/PostgreSQL isolado, com permissão para schema novo e `pgcrypto` no schema `extensions`.
- Edge Functions Deno e secrets de servidor: URL Supabase, service role e chave interna vNext.
- Gateway interno revisado para Gemini, caso a classificação/redação por modelo seja aprovada posteriormente.
- Agendador interno para chamar `support-inactivity-worker`; não é cron nem trigger habilitado neste pacote.
- Adaptador n8n futuro para carregar estado antes do classificador, agrupar mensagem, calcular hash de telefone, realizar comparação shadow e manter W-API fora dos novos componentes.

## A_CONFIRMAR — bloqueia ativação do respectivo fato/fluxo

- conteúdo oficial de qualquer preço, prazo, SLA, documento obrigatório, horário ou condição;
- formato/prefixo de protocolo por política que efetivamente crie solicitação;
- schemas de dados mínimos por serviço e por Reclamação;
- templates institucionais e de assunto de solicitação publicados;
- políticas de handoff e filas humanas;
- política de revogação e lista de atores autorizados para `EXPLICIT_REBIND`;
- endpoint/gateway Gemini, retenção e avaliação de segurança;
- adaptação da identidade/conversation ID do n8n para UUIDs vNext;
- regra de coexistência do estado legado com o state writer vNext;
- estratégia de envio do aviso de inatividade após sair de shadow.

Nenhuma dessas lacunas pode ativar leitura de `service_*` ou resposta factual por inferência.
