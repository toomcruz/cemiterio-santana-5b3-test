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
