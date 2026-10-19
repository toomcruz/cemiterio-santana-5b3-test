# Escopo de promoção — não autorizado e não aplicado

Este delta está implementado e testável em ambiente sintético. Não é uma habilitação de escrita em produção, nem prova da revisão de um operador real no novo fluxo.

## Alterações necessárias antes de pedir a liberação final

1. Portar o manifesto e a revisão atômica do lote para o armazenamento privado HOMOLOG existente, vinculando cada filho a um send-intent já suportado. Validar o operador individual com os verificadores reais existentes, a assinatura/audiência/expiração do OAuth e a sessão independente recente. Manter as identidades HOMOLOG e PROD distintas, vinculadas explicitamente. Testar o reaproveitamento das sessões reais e os casos de expiração/revogação na tela única.
2. Usar a permissão administrativa de envio supervisionado separada da leitura, já preparada no candidato anterior, acrescentando escopo explícito de lote e limite máximo de 50. Não ampliar implicitamente a concessão de leitura de sete dias. Preferências e base autorizada da comunicação devem vir da fonte oficial; ausência de autorização bloqueia o destinatário. Uma lista de números por si só não concede acesso.
3. Autorizar cada filho pelo coordenador oficial, preservando `sana_control_transition`, `sana_manual_whatsapp`, locks, revisão e watermark. A autorização do lote não poderá inventar ou substituir provas individuais: a migração deve produzir registros filhos auditáveis a partir da revisão exata do manifesto. Revalidar permissões/contexto no claim de cada filho. Não usar o lock SQLite do LAB em produção.
4. Reutilizar o agendamento/outbox oficial para o lote, com intervalo global e status por destinatário. Não criar cron/daemon/emissor concorrente. Preservar a pausa e as barreiras de Sana/n8n/Painel. Estado desconhecido interrompe o lote; não faz retry. Confirmar a projeção de cada filho no histórico oficial.
5. Montar as ferramentas no MCP existente, preservando App, OAuth, URL e túnel, após comprovar os gates anteriores. Atualizar o catálogo da conexão existente e testar a UI no ChatGPT. O protótipo atual é fixture-only e não será promovido por simples mudança de variável.

## O que não será alterado

Sana, OpenBot/Boss Bridge, n8n, W-API, webhooks, concessões e emissores atuais. Não há novas contas, plugins, túneis, projetos, serviços, assinatura ou endpoint direto W-API neste delta.

## Implantação e reversão

Antes de qualquer promoção, apresentar os arquivos/migrações finais e seus hashes, verificar drift das versões ativas e obter autorização específica do usuário. Fazer backup dos componentes alterados. A liberação de um piloto e cada envio real dependem de autorizações posteriores; esta implementação não as presume. Revogação desativa a concessão do lote e novas execuções, preservando auditoria e operações ambíguas.

No LAB não foi alterado nenhum serviço instalado. Para instalar o delta no MCP LAB ativo, é necessário acesso de escrita ao diretório root do serviço e uma integração de sessão humana real: não solicitamos execução de um patch root antes de concluir essa integração. As suítes do runner usam uma cópia isolada e temporária do MCP, encerrada ao final, sem deixar uma segunda operação ativa.
