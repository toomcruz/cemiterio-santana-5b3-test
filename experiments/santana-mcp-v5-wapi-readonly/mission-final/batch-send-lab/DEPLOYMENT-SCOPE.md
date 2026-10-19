# Escopo atual — MCP Santana LAB

A extensão existente está instalada, incluindo revisão autenticada, CSP própria e renderização offline do PDF. A conexão ativa confirmou a remoção do link inválido e preservação da auditoria do lote concluído de duas respostas. A concessão continua lab_fixture_simulation_only e não autoriza produção.

## LAB instalado e verificado no ChatGPT

A correção de uma linha de real-widget.html foi aplicada pelo operador: LAB_PREVIEW_COMPAT_FIXED, PID 1269467 inalterado, túnel preservado e nenhum serviço reiniciado. Backup /root/santana-mcp-backups/preview-compat-20261019T171318Z-1792429998042793004.

A verificação no componente real confirmou:

- PDF com imagem de página completa, naturalWidth=905 e naturalHeight=1280; dez textos carregados e anexos repetidos identificados como o mesmo documento.
- PNG sintético completo de 1000 x 600 pixels na preparação individual, com formulário de autenticação pessoal disponível.
- Imagens usam os mesmos bytes verificados em data URI, permitida pelas políticas existentes. A CSP própria continua aplicada com hashes fixados de script e estilo; não houve ampliação da política nem alterações de autenticação ou permissões.
- O lote PDF expirado permaneceu bloqueado, com zero tentativas e nenhuma aprovação HOMOLOG registrada (consulta de contagem somente leitura).
- O operador concluiu a revisão independente do lote af302ca6-09d4-46e2-a81d-b76dc03c2cf3. A conexão ativa confirmou approved para os dez itens antes da execução. O guard de recibo e sessão foi verificado novamente em cada passo. A simulação sequencial terminou completed, com dez accepted_by_api sintéticos, uma tentativa por destinatário, nenhum resultado desconhecido e retry_allowed=false em todos os itens. A reconciliação e a consulta final confirmaram os resultados, sem paginação omitida. Evidência: validation/authenticated-ten-pdf-simulation.json.

Os 11 testes focados anteriores passaram localmente e na VPS (workflow 39290019091): oito da interface e três da aplicação de arquivo. Não foram repetidos neste retorno; foram feitas verificações novas pela conexão e interface reais. Nenhuma mensagem real, concessão, registro de produção ou serviço foi alterado.

## Homologação do LAB concluída para o lote com PDF

A revisão pessoal no ChatGPT e o processamento simulado de dez respostas com PDF estão comprovados. O lote anterior de duas respostas também permanece concluído; não é necessário repetir essas execuções. A prévia PNG foi verificada na interface, sem execução autenticada de imagem nesta extensão. Todos os recibos desta validação são fictícios: não representam aceite da W-API nem entrega. O transporte real continua bloqueado. Não há intervenção manual pendente para este lote concluído.

As ferramentas preparar_envio_simplificado, preparar_lote, consultar_lote, executar_lote_simulado e reconciliar_lote estão disponíveis na conexão LAB existente. registrar_revisao_lote continua restrita ao componente autenticado, sem chamada pelo modelo. A etapa de produção abaixo permanece separada e não foi executada nesta validação.

## Produção — não autorizada nesta etapa

## Alterações necessárias antes de pedir a liberação final

1. Portar o manifesto e a revisão atômica do lote para o armazenamento privado HOMOLOG existente, vinculando cada filho a um send-intent já suportado. Validar o operador individual com os verificadores reais existentes, a assinatura/audiência/expiração do OAuth e a sessão independente recente. Manter as identidades HOMOLOG e PROD distintas, vinculadas explicitamente. Testar o reaproveitamento das sessões reais e os casos de expiração/revogação na tela única.
2. Usar a permissão administrativa de envio supervisionado separada da leitura, já preparada no candidato anterior, acrescentando escopo explícito de lote e limite máximo de 50. Não ampliar implicitamente a concessão de leitura de sete dias. Preferências e base autorizada da comunicação devem vir da fonte oficial; ausência de autorização bloqueia o destinatário. Uma lista de números por si só não concede acesso.
3. Autorizar cada filho pelo coordenador oficial, preservando `sana_control_transition`, `sana_manual_whatsapp`, locks, revisão e watermark. A autorização do lote não poderá inventar ou substituir provas individuais: a migração deve produzir registros filhos auditáveis a partir da revisão exata do manifesto. Revalidar permissões/contexto no claim de cada filho. Não usar o lock SQLite do LAB em produção.
4. Reutilizar o agendamento/outbox oficial para o lote, com intervalo global e status por destinatário. Não criar cron/daemon/emissor concorrente. Preservar a pausa e as barreiras de Sana/n8n/Painel. Estado desconhecido interrompe o lote; não faz retry. Confirmar a projeção de cada filho no histórico oficial.
5. Montar as ferramentas no MCP existente, preservando App, OAuth, URL e túnel, após comprovar os gates anteriores. Atualizar o catálogo da conexão existente e testar a UI no ChatGPT. O protótipo atual é fixture-only e não será promovido por simples mudança de variável.

## Preservação e promoção

Não substituir Sana, OpenBot/Boss Bridge, n8n, W-API, Painel, webhooks, túnel, OAuth ou canal oficial. Não criar contas, plugins, bancos, projetos ou serviços.

O protótipo LAB não será promovido apenas mudando uma variável. Antes de qualquer implantação em produção, apresentar arquivos/migrações finais, hashes, escopos e reversão, verificar a fonte ativa e obter autorização específica. A liberação do piloto e cada envio real dependem de autorizações posteriores. Revogação bloqueia novas execuções sem apagar auditoria ou liberar operações ambíguas.
