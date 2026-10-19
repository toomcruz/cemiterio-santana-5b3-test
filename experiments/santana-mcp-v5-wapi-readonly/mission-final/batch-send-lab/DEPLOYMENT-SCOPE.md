# Escopo atual — MCP Santana LAB

A extensão existente está instalada, incluindo revisão autenticada, CSP própria e renderização offline do PDF. A conexão ativa confirmou a remoção do link inválido e preservação da auditoria do lote concluído de duas respostas. A concessão continua lab_fixture_simulation_only e não autoriza produção.

## Única correção pendente no LAB

A verificação no ChatGPT encontrou uma incompatibilidade de imagem: a política herdada do contêiner permite data: em img-src e não permite blob:. O PDF foi renderizado na VPS, mas a imagem de sua página ficou com naturalWidth=0, e a aprovação foi bloqueada. Nenhum login ou revisão foi tentado. Evidência: validation/preview-browser-block.jpg.

A correção substitui apenas a criação do endereço da imagem, conservando os bytes e MIME previamente verificados. O mesmo ajuste serve para imagens originais e páginas de PDF. Autenticação, destinatários, textos, anexos, recibos, idempotência e CSP permanecem iguais. O gerador confere que o HTML final tem exatamente essa substituição de uma linha.

Arquivo preparado na VPS: /home/runner/santana-mcp-staging/batch-preview-fix-faf2b4b94ef8/apply-preview.py. SHA-256: faf2b4b94ef800a0e64d4d1e872bb0cc71871015fcfe643069836ca2b1535ce8. Comando: Aplicar-Correcao-Previa-LAB.txt.

A aplicação confere host, fonte, configuração, catálogo e HTML ativo, faz backup, substitui somente real-widget.html de forma atômica e compara o recurso servido com o candidato protegido. Não reinicia serviços nem escreve na auditoria. Falha posterior restaura o HTML anterior. Root é necessário porque o arquivo está em /root e o runner UID 1001 não possui sudo sem senha.

## Evidência e limites atuais

- Instalação root: LAB_UI_HARDENING_INSTALLED, PID 1269467, túnel preservado, PDF offline PASS.
- Prévia atualizada carregada após atualizar o catálogo do mesmo plugin; operação concluída sem opção de nova revisão.
- Lote sintético ba93726f-4a89-4209-800a-b99e0d58aaf8: dez respostas personalizadas, PDF sintético, todas com zero tentativas e sem aprovação.
- Workflow 39290019091, commit 6e421ac2f007b46e04c4ac7ac4b1cd44dbe3322d: oito testes da interface (sete regressões e um da política herdada observada), três de aplicação de arquivo, todos aprovados localmente e na VPS. HTTP loopback e arquivos reais sintéticos; operações privilegiadas simuladas, qualquer chamada de reinício falha o teste.
- Correção de imagem ainda não aplicada. Renderização corrigida e revisão humana do lote maior continuam pendentes. Nenhuma mensagem real foi enviada.

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
