> Estado atual: extensão instalada no LAB em 19/10, PID 972291, 12 ferramentas no servidor e envio real bloqueado. Uma leitura fictícia pelo plugin ativo foi confirmada. A sincronização das novas ferramentas no ChatGPT está bloqueada pela declaração visual indevida de uma ferramenta privada; correção mínima preparada e testada, aguardando root. Revisão humana ponta a ponta permanece pendente.

# Retomada — revisão individual real do LAB

HOMOLOG atualizado em 19/10/2026, exclusivamente para simulação. `sana-mcp-read` v15 preserva os cinco arquivos anteriores e acrescenta a rota `lab-review` e dois módulos. Nenhuma alteração em Supabase PROD, Painel, W-API, Sana, n8n, OpenBot ou ponte Boss.

O operador HOMOLOG já existente foi mantido. Uma concessão separada `lab_fixture_simulation_only` vincula essa identidade ao identificador do operador, até 25/10 às 19h25 de São Paulo; isso não comprova uma sessão PROD e não autoriza escrita em PROD. Não foi renovada ou alterada a concessão antiga de leitura sintética.

## Revisão operacional implementada

O componente apresenta todos os destinatários fictícios, textos e anexos. O operador autentica-se diretamente no Supabase HOMOLOG; senha e JWT não entram em argumentos MCP nem em registros de aprovação. Só o recibo de revisão chega ao MCP. O backend verifica assinatura via Auth, operador ativo, sessão atual, autenticação independente recente e o hash integral do manifesto. Os recibos são revogáveis e verificados novamente antes de cada operação simulada.

O cliente privado do LAB pode preparar apenas fixtures, com identidade de cliente explicitamente identificada como `lab_client`; isso não é apresentado como OAuth individual. A identidade humana real é exigida na revisão. O plugin de leitura OAuth de produção é preservado.

A sessão temporária de revisão só pode ser reutilizada pelo componente em sua origem dedicada, configurada com o domínio HOMOLOG existente; fora dela o JWT fica apenas na memória do componente. A senha é limpa após a única tentativa de login e nunca é armazenada. Bloqueio da prévia PDF pelo cliente mantém a aprovação do anexo bloqueada; sua renderização ainda precisa ser conferida no ChatGPT real.

## Evidências

- Os 73 testes anteriores foram preservados. O runner executou 59 verificações focadas: 46 Python (40 regressões afetadas e 6 novas), 7 de autenticação real com transporte simulado e 6 SQL sobre recibos/revogação. Todos passaram. Não são 73 testes novos nem prova de login humano concluído.
- Execução: https://github.com/toomcruz/cemiterio-santana-5b3-test/actions/runs/39230724415
- A fonte exata esperada no serviço tem SHA-256 `4c2b376f9850d0249e5d849c708ffac523c9d808baeaf78351fd75fb4267260b`. A extensão passou no smoke reconstruído a partir do pacote instalado e patch auditado, com 12 ferramentas, preparação fictícia e metadados privados do componente. Nenhum instalador antigo foi executado.
- API HOMOLOG: consulta anônima de recibo inválido retornou HTTP 200 com `not_available`; preflight da rota de revisão retornou 204. Tabelas novas com RLS, sem SELECT para anon/authenticated. A ausência de policies é intencional para acesso direto fechado; os avisos WARN dos advisors não aumentaram.

## Bloqueio de instalação confirmado

Runner UID 1001: sem sudo sem senha, sem leitura/escrita no código root do LAB. A Hostinger restringe login automatizado deste navegador; não foi tentado contornar essa restrição. O ChatGPT Plugins voltou a ficar observável, e o plugin LAB existente ainda anuncia somente as seis ferramentas de leitura.

O instalador conferido será aplicado apenas a `santana-mcp-lab.service`, na mesma porta e diretório. Faz backup do código original e do SQLite, acrescenta um launcher por drop-in do serviço, preserva o túnel e restaura o lançamento anterior em caso de falha. Não copia credenciais para arquivos e não habilita transporte real. O arquivo original `server.py` não é substituído. Para reverter, remover somente o drop-in `90-batch-lab.conf`, recarregar systemd e reiniciar apenas o LAB, preservando a auditoria.

Depois da aplicação root: conferir o relatório, atualizar o catálogo do mesmo plugin e pedir ao operador a revisão de um único lote fictício na interface protegida. Até isso ocorrer, as novas ferramentas não estão comprovadas no ChatGPT, a revisão humana real não está comprovada ponta a ponta e a homologação não está concluída. Nenhum envio WhatsApp real integra essa etapa.

## Recuperação da instalação — 19/10/2026

A execução root do instalador f98ee7272d80 retornou INSTALL_FAILED_LAB_RESTORED_NO_PRODUCTION_CHANGE. O runner confirmou depois: LAB ativo, PID 836778, GET loopback 405, drop-in ausente e túnel inalterado (PID 1219382). O erro original não foi preservado pelo instalador anterior e não é legível pelo runner. Sua causa exata ainda não foi identificada.

A hipótese inicial de escrita bloqueada não foi comprovada: a unidade possui StateDirectory=santana-mcp-lab e SANTANA_AUDIT_DB=/var/lib/santana-mcp-lab/audit.sqlite3. Essa configuração permite o estado persistente sob ProtectSystem=strict. Nenhuma permissão de montagem foi ampliada.

O novo instalador faz preflight na namespace de montagem do LAB usando uma cópia temporária da auditoria existente, observa a inicialização por até 15 segundos sem repetir autenticação recusada, usa o ambiente do novo processo e exclui proxies da consulta loopback. Tanto a falha quanto a restauração geram JSON sem segredos. O launcher preserva acquire_runtime_lock e recover_inflight do v5.

Seis testes de instalação/recuperação passaram localmente e no runner (processos Python e SQLite reais com dados sintéticos; systemd simulado): inicialização lenta, esquema incompatível, falha HTTP 401 com rollback, ausência de segredos em erro, exclusão de segundo processo e preservação de resultado desconhecido após reinício. Workflow 39252379679, commit 7d4c5b5c3248452e8efe983815137bedcc008726. Os 73 testes anteriores e as 59 verificações focadas não foram repetidos.

Payload final conferido na VPS: /home/runner/santana-mcp-staging/batch-auth-4d034ccf50fd/install-lab.py, SHA-256 4d034ccf50fd09b2ed79b7b31e974ea0007aa69d590e20c720836e8b765e171a. Runner UID 1001, sudo sem senha indisponível. A nova aplicação root e o fluxo humano no ChatGPT continuam pendentes.

## Checagem de inicialização — segunda execução root

O relatório fornecido pelo operador confirma mount_and_existing_audit_preflight=PASS, falha na fase observe_new_lab_process_catalog com LAB_RUNTIME_CONFIGURATION_CHANGED e lab_restored=true. A checagem anterior podia observar o ambiente transitório publicado antes do execve do launcher. Esse defeito foi reproduzido no runner com um PID real inicialmente sem o ambiente definitivo, retornando o mesmo código. O relatório antigo não contém os valores comparados, portanto a reprodução não prova isoladamente qual variável estava ausente naquela execução.

O instalador agora aguarda o launcher efetivamente executado e a porta loopback pertencente ao mesmo PID antes de ler/verificar seu ambiente. A checagem de banco/porta continua obrigatória; alterações reais provocam rollback e metadados booleanos explicam a divergência, sem expor valores sensíveis. A configuração original também é verificada antes de alterar o serviço. Não foram ampliadas permissões.

Workflow 39256614821, commit b926d640891ff99fdfefdf81fbdbecbf27842529: 8 testes aprovados, sem skips, em 26,305 segundos. Processos, SQLite e leituras /proc são reais com dados sintéticos; systemd é simulado. Inclui reprodução do erro pré-exec e rejeição de alteração real da auditoria. A verificação local teve 6 aprovados e 2 ignorados por restrição de leitura de /proc no runtime local; a evidência válida dos dois casos vem do runner.

Payload conferido e disponível em /home/runner/santana-mcp-staging/batch-auth-a9cca6b9732d/install-lab.py, SHA-256 a9cca6b9732d06b36dc647206b4fab33b9b5ea43e93b432421f4139ec603e02c. Runner sem sudo. LAB ativo (PID 911654), túnel com PID 1219382. Instalação root e revisão humana no ChatGPT seguem pendentes.

## Instalação confirmada e compatibilidade do catálogo

O operador executou o payload a9cca6b9732d e retornou LAB_EXTENSION_INSTALLED, preflight na namespace PASS, 12 ferramentas, fixture, real_send_enabled=false, whatsapp_sends=0, production_changes=0 e túnel inalterado. O runner confirma LAB PID 972291 e túnel PID 1219382 ativos. Uma chamada pelo próprio plugin ChatGPT listar_conversas retornou source=fixture e conversation-demo-01.

Em Configurações do plugin LAB existente, Atualizar ferramentas retornou: Estas ferramentas privadas não podem renderizar seus widgets: registrar_revisao_lote. Não houve recriação do plugin nem ampliação de permissões. O catálogo do ChatGPT continua com as seis ferramentas anteriores.

Correção: substituir somente registrar_revisao_lote._meta.ui por {visibility:[app]}, retirando resourceUri da ferramenta interna. Os métodos públicos de preparação continuam associados ao componente visual. Autenticação, recibos, concessões, textos, anexos e transporte permanecem inalterados. Referência primária: https://github.com/openai/openai-apps-sdk-examples/blob/main/mcp_app_basics_node/src/server.ts, exemplo call_server_tool__roll_dice.

Workflow 39262685083, commit 6f22710f45cccb92e8a34d76c3e99e13bea21670: três testes focados aprovados localmente e no runner (16,613 segundos no runner): descritor privado sem renderização, aplicação mínima/idempotente em LAB já instalado e restauração da fonte anterior quando a checagem HTTP falha. Processos e SQLite reais sintéticos, systemd simulado. Nenhum envio ou serviço real foi alterado nesses testes.

Patch guardado disponível em /home/runner/santana-mcp-staging/batch-ui-fix-3bde3eb674b3/fix-ui-metadata.py, SHA-256 3bde3eb674b3bdf160265ba6c4c88cd9e71f8c0faf8810360926d8721899ef0a. Confere a fonte instalada (0fad711f...), faz backup, altera somente mcp_extension.py para ec7f35c1..., reinicia apenas o LAB e verifica o catálogo. Runner UID 1001 sem sudo; aplicação root ainda pendente.
