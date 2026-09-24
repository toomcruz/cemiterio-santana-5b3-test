# Deploy automático da bridge privada LAB

Escopo: `sana-lab-bridge` na rede existente `n8n-ntga_default`, usando o checkout existente `/docker/sana-lab-bridge-src`. O workflow `m6y2AD8Vx1QZaJiE`, o canário e os serviços oficiais não fazem parte do deploy. O processo preserva os dois mounts da bridge existente (`/lab-state` e `/run/secrets/sana_lab_token`) sem transportar o segredo para o GitHub.

## Fluxo normal

Um `push` na branch `sana-lab-exumacao-f0-f2` que altere código/imagem ou o workflow de deploy aciona `.github/workflows/sana-lab-bridge-deploy.yml`. O job de validação fixa `github.sha`, verifica tipos e testes Deno, scripts Bash e transições locais de deploy/rollback. O job seguinte, serializado, usa SSH com host key fixada para invocar exclusivamente `deploy <SHA>` na VPS. A VPS obtém o HEAD da branch, exige igualdade exata, confere o container atual, constrói `sana-lab-bridge:<12 primeiros caracteres do SHA>` com label OCI de revisão e troca só a bridge. Confere rede única, zero portas públicas, mounts, container rodando, hashes `engine.ts`/`recadastro.ts`, HTTP 401 sem token e HTTP 200 autenticado com caso sintético LAB. O probe autenticado lê o secret **apenas dentro do container**, imprime somente status/contrato e não cria operação de negócio. O container antigo permanece parado para rollback.

Ao concluir, grava `/var/lib/sana-lab-deploy/active.txt` com commit, imagem, image ID e hashes sem segredo. O log do Actions traz `DEPLOY_OK COMMIT=... IMAGE=... IMAGE_ID=...` e a confirmação do probe. Se uma verificação falhar depois de interromper a bridge anterior, o script repõe o container anterior, confere imagem, hashes, rede, ausência de porta e 401, grava `ROLLED_BACK` e emite `ROLLBACK_CONFIRMED=YES`; falha na recuperação emite `ROLLBACK_CONFIRMED=NO` e status de erro. A injeção `rollback-test` ocorre após o probe e deve terminar com a imagem anterior ativa.

## Instalação administrativa revisada (uma vez por mudança dos wrappers)

O pacote administrativo desta revisão é `install-reviewed-deploy-scripts.sh` mais os três fontes que ele instala, todos retirados do commit integral selecionado no checkout confiável. Ele **não executa nem chama `bootstrap-deploy-access.sh`**, não cria usuário, não altera `authorized_keys`, sudoers, SSH, permissões da chave, firewall ou bridge. Ele falha se o estado administrativo existente não passar no preflight.

A intervenção deve ocorrer por administrador na VPS, após revisão independente do SHA e do fingerprint público correspondente à chave já configurada como `SANA_LAB_DEPLOY_SSH_KEY` no GitHub Environment `sana-lab`. Selecionar a chave por arquivo público explícito e fingerprint explícito — nunca pela primeira chave encontrada. O fingerprint é público; não imprimir nem transferir a chave privada.

```bash
cd /docker/sana-lab-bridge-src
git status --porcelain
git rev-parse HEAD
ssh-keygen -lf /caminho/explícito/sana-lab-deploy.pub -E sha256
sudo bash sana-lab/install-reviewed-deploy-scripts.sh \
  <SHA_COMPLETO_REVISADO> \
  /caminho/explícito/sana-lab-deploy.pub \
  <FINGERPRINT_SHA256_CONFIRMADO_DA_CHAVE_DO_GITHUB>
```

O procedimento exige branch `sana-lab-exumacao-f0-f2`, checkout limpo e HEAD igual ao SHA; verifica `sana-lab-deploy` com senha bloqueada `NP`, ausência do grupo `docker`, arquivo `authorized_keys` com exatamente uma ocorrência da chave escolhida e forced command `restrict,command=.../sana-lab-ssh-dispatch`, `visudo -c` e uma única regra sudo para `/usr/local/sbin/sana-lab-deploy-entry`. O script só lê e confere essas políticas, sem reescrevê-las.

Antes da instalação, cria backup root-only em `/var/backups/sana-lab-admin/<UTC>-<SHA12>` dos arquivos administrativos atuais e manifesto de hashes. Instala como `root:root`, modo `0755`, somente estes arquivos:

| Fonte revisada no commit | Destino root-owned na VPS |
|---|---|
| `sana-lab/deploy-entry.sh` | `/usr/local/sbin/sana-lab-deploy-entry` |
| `sana-lab/ssh-dispatch.sh` | `/usr/local/libexec/sana-lab-ssh-dispatch` |
| `sana-lab/deploy-functional-gate.sh` | `/usr/local/sbin/sana-lab-deploy-functional-gate` |

Depois compara hashes instalados com os blobs do SHA revisado, modos/ownership, `authorized_keys`, sudoers e um snapshot sanitizado da bridge (container/image, estado, rede, portas, mounts e hashes do engine). Se qualquer validação posterior falhar, restaura os três scripts do backup e confirma a reversão. A bridge, seu `/lab-state` e seu secret são somente verificados, não alterados. O marcador `ADMIN_INSTALL=PASS` comprova apenas a instalação/verificação administrativa; não comprova correção de `Permission denied`, deploy da nova imagem ou progressão conversacional.

**Arquivos administrativos que podem ser modificados:** somente os três destinos da tabela, mais a criação do diretório/backup e manifesto sob `/var/backups/sana-lab-admin`. `authorized_keys`, sudoers, conta, homes, Docker, bridge, mount, secret e firewall não são modificados. Não executar o bootstrap antigo.

## Acionamento, evidência e limites

- Normal: publicar commit na branch LAB (arquivos afetados pelo workflow). Acompanhar GitHub Actions → **SANA LAB — deploy bridge privada** → `validate` → `deploy`; o SSH exibe apenas versão/hash/status. Depois conferir `docker inspect sana-lab-bridge` e `/var/lib/sana-lab-deploy/active.txt` na VPS se houver incidente. Um commit já superado na branch é rejeitado antes da troca.
- Rollback sintético pela própria branch LAB: criar um commit cujo assunto seja exatamente `[sana-lab-rollback-test]` e que modifique um arquivo incluído no filtro `push` (por exemplo, este documento). O job valida o mesmo commit, implanta temporariamente a imagem, força uma falha **depois** do probe, restaura a bridge anterior e exige `ROLLBACK_CONFIRMED=YES`, sem `DEPLOY_OK`. Depois, um commit normal aciona o deploy habitual. O `workflow_dispatch` também aceita `mode=rollback-test` **quando este workflow estiver presente na branch padrão**; não é necessário alterar `main` para provar rollback via `push`.
- Baseline da prova controlada: run `36023834176` implantou o commit `079eaa43a7d4ff105a03a467320118d364079c09` como `sana-lab-bridge:079eaa43a7d4`. O rollback deve confirmar que esta imagem retorna à operação.
- Resultado da prova controlada: run `36038598654`, commit `452efc872e746b94691e1a184be67da8a9cb366a`; imagem temporária `sana-lab-bridge:452efc872e74`, probe HTTP 200, falha sintética após o probe e `ROLLBACK_CONFIRMED=YES` para a imagem `sana-lab-bridge:079eaa43a7d4` (mesmo image ID do baseline). A troca usa os mesmos mounts LAB e não publica portas. O commit documental seguinte aciona deploy normal para alinhar o runtime ao HEAD.
- Recuperação manual excepcional: como administrador da VPS, usar o mesmo script do checkout limpo `bash sana-lab/deploy-functional-gate.sh <SHA_ATUAL> deploy` para avançar. Se a bridge não partir, preservar `/lab-state` e o secret e examinar `docker inspect sana-lab-bridge`; para voltar a um backup parado, interromper o novo container, renomear o backup `sana-lab-bridge-before-...` para `sana-lab-bridge` e iniciá-lo, depois conferir imagem, hashes, rede e HTTP 401. Não apagar backup nem volume LAB durante o diagnóstico.

**Gate operacional:** código, testes locais e workflow publicado não comprovam SSH configurado, execução real do Actions ou rollback na VPS. Exigir IDs de runs, imagem/commit/hash ativos e rollback controlado real antes de `DEPLOY_AUTOMATION=PASS`. Isto tampouco homologa operações oficiais ou atendimento completo.

## Diagnóstico restrito antes do rollback

O forced command aceita apenas `deploy <SHA>`, `rollback-test <SHA>` e `diagnose <SHA>`, com SHA completo da HEAD da branch LAB. Não há shell arbitrário, comando Docker remoto parametrizável nem leitura de credenciais. Em falha **depois** da troca, o script root-owned invoca `diagnose-container.py` enquanto o container novo ainda existe, confere sua imagem e label OCI contra o SHA esperado, salva `/var/lib/sana-lab-deploy/diagnostics/<SHA>.txt` (0600) e só então remove o novo container e confirma o rollback. `diagnose <SHA>` lê apenas esse relatório sanitizado; se ausente, falha. Se a coleta também falhar, o rollback continua e `DIAGNOSTIC_CAPTURE_FAILED` fica registrado.

O relatório contém State.Status, ExitCode, State.Error **classificado**, RestartCount, OOMKilled, StartedAt, FinishedAt, Health, comando/entrypoint em allowlist, user, read_only, destinos/tipos/permissões dos mounts, UID/GID/modo e verificação dos bits POSIX de leitura/escrita/execução para UID/GID 1000, nome da rede e indicação de portas públicas. O helper apenas consulta `stat` nos source dos mounts; não imprime esses caminhos, não abre arquivos nem lê conteúdo de estado ou secret. A verificação dos bits POSIX não considera ACLs. Nenhum valor de env ou linha de log bruta sai no relatório. Até 100 linhas finais preservam tipo de erro, operação exigida, recurso/caminho seguro, mensagem Deno normalizada e stack frame de código. Caminhos de segredo, valores de credenciais, Authorization/Bearer e conteúdo de arquivos são mascarados. Quando o deploy falha, o Actions invoca automaticamente `diagnose <SHA>` e registra o relatório já sanitizado. O modo `workflow_dispatch: diagnose` exige o SHA atual da branch (somente quando o workflow estiver disponível na branch padrão).

**Mudança do procedimento privilegiado:** `ssh-dispatch.sh`, `deploy-entry.sh` e `deploy-functional-gate.sh` instalados na VPS são cópias root-owned. O entrypoint compara o hash da cópia instalada com o SHA do candidato. Um push isolado pode parar em `DEPLOY_SCRIPT_UPDATE_NEEDS_BOOTSTRAP` antes de tocar a bridge. Para esta atualização, use exclusivamente o procedimento administrativo revisado acima; não execute o bootstrap antigo. Depois que o administrador confirmar `ADMIN_INSTALL=PASS`, reexecute o run de deploy/validação do SHA aprovado (preferencialmente o run existente, se compatível) e exija evidência do job `validate` e do job `deploy` em separado. Deploys normais seguintes continuam pelo Actions.

**Comparação CI × VPS:** o smoke do CI usa `--network none`, token sintético e diretórios temporários do runner. O deploy na VPS usa a rede privada `n8n-ntga_default`, mount persistente `/lab-state` e secret existente; ambos usam `--read-only`, `--user 1000:1000` e a mesma imagem. CI PASS não comprova acesso real aos mounts, formato do secret, permissões da VPS ou estabilidade do processo; classificar causa só após o relatório da falha real. Não executar C01–C15 enquanto a imagem nova reiniciar.
