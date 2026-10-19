# Escopo de promoção — não autorizado e não aplicado

Este delta tem implantação no LAB e prova positiva da revisão autenticada de um lote fictício de duas respostas. Isso não habilita escrita em produção: a concessão é lab_fixture_simulation_only e o transporte real é impossível no candidato. O ajuste posterior de CSP/PDF/link passou nas 23 verificações locais e na VPS; está preparado e aguarda aplicação root no LAB, ainda não realizada.

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

O LAB já recebeu a extensão e o corretivo de metadados, preservando o túnel e o servidor original. A revisão individual real funcionou e o lote de duas respostas terminou com exatamente uma tentativa simulada por destinatário. O próximo patch é limitado a CSP, prévias e tratamento da interface; não amplia concessões e não cria envio real. A execução corrigida 39287494403 (commit e1e0f4704becba4ef5e29eeaeca233e943ff1c55) aprovou as 23 verificações. A falha anterior foi confirmada como FileNotFoundError de um PDF local não versionado; teste e gerador agora usam o fixture canônico versionado. Runner UID 1001, sudo sem senha indisponível; LAB PID 1013288 e túnel PID 1219382 continuam ativos.

## Única aplicação privilegiada pendente — LAB

Arquivo preparado na VPS: /home/runner/santana-mcp-staging/batch-ui-hardening-1b42cdb70681/apply-lab.py. SHA-256: 1b42cdb706816494b8fc80563fbb5aef966a1c995e2b3e44555040cb167f4d5a. O comando íntegro está em Aplicar-Correcao-LAB.txt.

Substitui três arquivos da extensão, acrescenta três módulos auxiliares e bibliotecas offline restritas ao diretório do LAB. Faz backup e preflight de PDF/protocolo antes de reiniciar somente santana-mcp-lab.service; falha de saúde restaura o código anterior e preserva auditoria/resultados desconhecidos. Confere fonte, configuração e catálogo, preserva túnel e server.py. Não altera concessões, OAuth, Supabase, produção ou envio real. A comprovação da aplicação e a validação do componente no ChatGPT continuam pendentes.
