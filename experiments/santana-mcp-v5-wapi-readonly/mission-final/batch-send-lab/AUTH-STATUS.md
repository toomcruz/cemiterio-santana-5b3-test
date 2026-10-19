> Estado atual (19/10, após 16h32 UTC): revisão autenticada e simulação de duas mensagens permanecem comprovadas. Plugin existente atualizado para 1.0.2, mesma identidade/App/conexão, com orientação explícita contra o link inválido. Correções do serviço LAB para CSP no próprio HTML, prévia offline integral de PDF e remoção do approval_url passaram em 23 verificações locais (17 novas, 6 regressões de Auth). Não estão instaladas na VPS: workflow 39285317093 segue queued, runner online e ocioso, sem iniciar o job. GitHub Status informa incidente em Actions e atrasos de workflows desde 15h49 UTC. Nenhum comando root foi solicitado nesta retomada porque o estágio na VPS ainda não ocorreu. Fonte 4db10dc4a670d049143eec7895ac457b99c9645f. Produção e envios reais continuam bloqueados.

# Retomada — revisão individual real do LAB

## Ajustes finais de interface — estágio aguardando GitHub Actions

O plugin privado preserva App, conexão, apresentação, permissões e audiência. A atualização 1.0.2 altera somente orientações de operação e a versão exigida pelo formato. A leitura de volta confirmou as orientações novas e o mesmo App asdk_app_6ad3b0cbf1108191bc5ce4546eb8a4c8. O servidor ativo ainda pode devolver o campo incorreto approval_url até a aplicação do patch; ele não deve ser aberto nem compartilhado.

O patch substitui três arquivos da extensão e acrescenta três auxiliares, sem substituir server.py, launcher, catálogo ou transporte. Usa CSP com hashes exatos dos scripts/estilos no próprio HTML, somente Auth HOMOLOG como conexão de rede, sem frames, objetos ou ativos externos. O renderizador administrativo existente é reaproveitado em subprocesso offline com ambiente limpo, CPU/memória/tempo limitados e cache de quatro documentos. PDFs de até oito páginas têm prévia completa verificada; documento ilegível ou incompleto mantém a aprovação bloqueada. Uma cópia de anexo repetida no lote tem a mesma prévia, evitando renderizações duplicadas no telefone. Validade e estados já revisado/concluído são tratados na interface.

Os 23 checks locais passaram: 7 novos Python, 7 novos DOM/JavaScript, 3 novas transações de instalação/rollback e 6 regressões de autenticação afetadas. As transações usam processos, arquivos, bibliotecas e SQLite reais com fixtures; systemd é simulado. Os 73 testes originais não foram repetidos. Não são prova de CSP aplicada no navegador real: essa verificação e os lotes maiores autenticados dependem da instalação.

Workflow único batch_ui_hardening reutiliza o runner da VPS, prepara dependências com as mesmas versões já validadas, testa e tenta sudo não interativo existente. Não concede sudo. Se faltar privilégio, deixa somente um payload com digest fixado, backup e rollback; só então caberá uma ação root consolidada. O job ainda não iniciou, portanto não há novo payload auditado disponível na VPS nem resultado de teste do runner para este delta. A API informa runner online/busy=false e o run queued. GitHub Status confirmou incidente 8tzbpcnl75jp em Actions/Pages/Webhooks, com atrasos no processamento; é compatível com a fila observada, sem provar isoladamente sua causa.

Evidência: validation/ui-hardening-checkpoint.json. Nenhuma alteração em Supabase, Sana, n8n, OpenBot, Boss, W-API ou atendimento de produção nesta retomada. O candidato de lote continua fixture-only; sua revisão HOMOLOG não autoriza escrita em PROD. A promoção ainda exige integrar a concessão administrativa e os filhos ao coordenador/outbox oficial, validar e apresentar o escopo específico antes da autorização de produção.

## Aprovação humana e processamento confirmados — 19/10, 13h03 São Paulo

A notificação do componente foi tratada apenas como contexto, sem presumir autorização. consultar_lote confirmou state=approved, manifesto 8945de4d7137841094e9c165a7e86708977dfb1dfaa9b9d2bf51469078191db2 e zero tentativas no lote ea6ee32c-9330-4b3a-beee-d5f2f43477b4. O guard instalado RealReview exige prova do recibo HOMOLOG, sessão atual e concessão LAB antes de cada passo. As duas chamadas de executar_lote_simulado retornaram accepted_by_api com simulated=true para os IDs exatos aprovados. reconciliar_lote confirmou um recibo sintético por destinatário; o passo seguinte encerrou o lote com completed sem nova operação. A consulta final confirmou duas tentativas totais, uma por destinatário, retry_allowed=false e real_dispatch_enabled=false.

Essa é evidência positiva da integração entre revisão humana autenticada e processamento simulado pelo ChatGPT. Nenhuma chamada à W-API real, alteração de produção, ampliação de concessão ou credencial nova foi necessária. accepted_by_api neste registro é resultado do transporte sintético, não aceite da W-API real nem entrega em celular. Artefato: validation/chatgpt-authenticated-simulation.json.

O endereço legado approval_url retornado pelo servidor é incorreto e não foi entregue nesta etapa como revisão funcional. A revisão efetiva ocorreu pelo componente nativo; não existe ainda um link externo validado para esse novo fluxo. A observação do navegador em nuvem permaneceu na tela de login anterior, portanto não foi usada como prova de autenticação; a prova é o estado do servidor e os passos protegidos. Segurança sob CSP aplicada, prévias nativas de anexos e processamento autenticado de lotes maiores permanecem pendentes de validação específica, sem repetir testes automáticos já concluídos.

## Validação direta no ChatGPT — catálogo corrigido

O relatório root do operador confirmou LAB_UI_METADATA_FIXED, backup ui-metadata-20261019T135940Z-1792418380744701056, 12 ferramentas no servidor, registrar_revisao_lote com visibility=[app] sem renderização e nenhum envio, alteração de produção ou permissão. A atualização do catálogo pela interface do plugin existente foi concluída.

As chamadas prepararam um envio individual, duas respostas personalizadas e comunicados para 10 e 50 contatos fictícios. Os resultados incluem todas as operações, sem paginação omitida, destinatários e IDs únicos, zero tentativas e real_dispatch_enabled=false. Repetir a preparação idempotente de duas respostas preservou exatamente lote, manifesto e IDs. Uma tentativa controlada de simulação antes da revisão retornou LAB_REAL_REVIEW_REQUIRED; nenhuma operação foi despachada.

O teste pela interface ChatGPT consultar_lote mostrou a prévia integral e o formulário HOMOLOG dentro do componente nativo. A entrada protegida automática não reconheceu os seletores do formulário embutido (locator_invalid); não houve tentativa de autenticação. A autenticação e o clique de aprovação devem ser realizados pessoalmente pelo operador. A configuração global preexistente de CSP para aplicativos personalizados está desativada e foi apenas observada, sem alteração; segurança sob CSP aplicada ainda não foi comprovada. O campo legado approval_url aponta a uma rota inexistente do ChatGPT e não foi aberto nem entregue como link de revisão. A interface nativa é o caminho testado nesta etapa.

Evidência sanitizada: validation/chatgpt-native-catalog.json. Não há senha, JWT, nonce ou conteúdo de munícipes reais nesse arquivo. Os testes automáticos já aprovados não foram repetidos nem apresentados como prova de autenticação humana.

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

## Revisão autenticada e ajuste do componente — atualização atual

A revisão humana real do lote ea6ee32c-9330-4b3a-beee-d5f2f43477b4 foi comprovada pelo backend e suas duas operações concluíram em simulação. Esse fato substitui as pendências históricas acima. A orientação do mesmo plugin foi atualizada para evitar a rota de revisão inexistente.

O ajuste adicional de CSP e prévia de PDF ainda não está instalado. Workflow 39285317093 executou e falhou antes de alterar serviços, na suíte de 13 testes Python. O resultado chegou atrasado durante incidente do GitHub Actions. Foi encontrada uma diferença de fonte: o teste e o gerador usavam um PDF local não versionado. Agora usam o PDF canônico em fixtures.json, com integridade conferida no gerador. Os 13 testes e os 3 de instalação passaram localmente com o PDF solto temporariamente removido. A nova validação na VPS deve confirmar o erro anterior e os testes corrigidos antes de preparar qualquer ação root.

## Runner corrigido aprovado; aplicação privilegiada pendente

Workflow 39287494403, job 118178703376: 13 verificações Python (incluindo 6 regressões de autenticação), 7 da interface e 3 de instalação/rollback, todas aprovadas sem skips. Total 23, com systemd simulado e processos/SQLite reais sintéticos. O log anterior foi recuperado sob SHA conhecido e confirmou três FileNotFoundError do PDF local. Patch preparado, 54535 bytes, SHA 1b42cdb706816494b8fc80563fbb5aef966a1c995e2b3e44555040cb167f4d5a. Runner UID 1001 sem sudo não pode aplicá-lo. Código da interface ainda não instalado; serviço LAB e túnel seguem nos mesmos PIDs. Nenhum envio real, mudança de produção ou concessão. Evidência: validation/ui-hardening-runner.json.

## Serviço atualizado e ajuste de imagem preparado

O relatório root LAB_UI_HARDENING_INSTALLED foi confirmado pela conexão ativa. A atualização do catálogo na interface recarregou o recurso e o lote concluído ficou sem opção de nova revisão. O PDF de um novo lote de dez permaneceu bloqueado pela CSP herdada, que não permite img blob:. Correção isolada para data URI, permitida na mesma política, aprovada em 11 verificações locais e no runner (workflow 39290019091). Patch de um HTML preparado, sem reinício de serviço e sem mudanças de concessões. Aplicação root e prova visual corrigida pendentes. Não houve tentativa de login, aprovação humana ou envio real neste turno.

## Prévia corrigida comprovada na interface real

O operador retornou LAB_PREVIEW_COMPAT_FIXED, sem reinício, com PID 1269467 e túnel inalterados. Após atualizar o catálogo existente, o componente real exibiu PDF (905 x 1280) e imagem PNG (1000 x 600) usando data URI sob a CSP preservada. O lote PDF expirado tinha zero tentativas e zero recibos HOMOLOG; foi preparada nova revisão de dez respostas sintéticas. Nenhum login, aprovação ou envio real foi executado pelo agente. Referência atual: validation/preview-live-verified.json. Não há nova alteração de código pendente para essa prévia; falta a revisão independente e simulação autorizada do lote maior.

## Revisão independente e simulação de dez respostas com PDF concluídas

Em 19/10/2026, a conexão ativa confirmou o lote af302ca6-09d4-46e2-a81d-b76dc03c2cf3 em approved, com dez itens aprovados e zero tentativas anteriores. Manifesto 6a2b1702e3b1cdf09928c974139628d9f250ec0a933174f852d0f3e0db38e956. O operador autenticou-se e revisou pessoalmente; a mensagem no chat não foi usada como prova suficiente. O guard existente verificou o recibo HOMOLOG, a sessão e a concessão novamente antes de cada operação fictícia.

Foram processados sequencialmente dez destinatários fictícios com respostas individuais e o PDF sintético já exibido. Resultado final completed, accepted_by_api=10, uma tentativa por operação, retry_allowed=false e nenhum resultado desconhecido. Reconciliação e consulta final confirmaram dez itens sem páginas omitidas. Cada recibo tem simulated=true e delivery_confirmed=false. Não houve chamada W-API, envio WhatsApp, mudança de produção, reinício de serviço ou alteração de permissão nesta execução.

Evidência atual: validation/authenticated-ten-pdf-simulation.json. Esta conclusão substitui as pendências históricas de revisão e execução do lote PDF acima. Os testes locais/runner já concluídos não foram repetidos. O PNG tem prévia real comprovada; não foi feita execução autenticada de imagem nesta extensão. A ponte de lote para produção continua separada, conforme DEPLOYMENT-SCOPE.md, e exige implementação, validação e autorização específicas.
