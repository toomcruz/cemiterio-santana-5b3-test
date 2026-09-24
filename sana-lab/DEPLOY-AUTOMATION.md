# Deploy automático da bridge privada LAB

Escopo: `sana-lab-bridge` na rede existente `n8n-ntga_default`, usando o checkout existente `/docker/sana-lab-bridge-src`. O workflow `m6y2AD8Vx1QZaJiE`, o canário e os serviços oficiais não fazem parte do deploy. O processo preserva os dois mounts da bridge existente (`/lab-state` e `/run/secrets/sana_lab_token`) sem transportar o segredo para o GitHub.

## Fluxo normal

Um `push` na branch `sana-lab-exumacao-f0-f2` que altere código/imagem ou o workflow de deploy aciona `.github/workflows/sana-lab-bridge-deploy.yml`. O job de validação fixa `github.sha`, verifica tipos e testes Deno, scripts Bash e transições locais de deploy/rollback. O job seguinte, serializado, usa SSH com host key fixada para invocar exclusivamente `deploy <SHA>` na VPS. A VPS obtém o HEAD da branch, exige igualdade exata, confere o container atual, constrói `sana-lab-bridge:<12 primeiros caracteres do SHA>` com label OCI de revisão e troca só a bridge. Confere rede única, zero portas públicas, mounts, container rodando, hashes `engine.ts`/`recadastro.ts`, HTTP 401 sem token e HTTP 200 autenticado com caso sintético LAB. O probe autenticado lê o secret **apenas dentro do container**, imprime somente status/contrato e não cria operação de negócio. O container antigo permanece parado para rollback.

Ao concluir, grava `/var/lib/sana-lab-deploy/active.txt` com commit, imagem, image ID e hashes sem segredo. O log do Actions traz `DEPLOY_OK COMMIT=... IMAGE=... IMAGE_ID=...` e a confirmação do probe. Se uma verificação falhar depois de interromper a bridge anterior, o script repõe o container anterior, confere imagem, hashes, rede, ausência de porta e 401, grava `ROLLED_BACK` e emite `ROLLBACK_CONFIRMED=YES`; falha na recuperação emite `ROLLBACK_CONFIRMED=NO` e status de erro. A injeção `rollback-test` ocorre após o probe e deve terminar com a imagem anterior ativa.

## Preparação única, fora do chat

1. Gerar **um par de chaves SSH exclusivo para este deploy**, numa estação de administração confiável. A chave pública é instalada uma única vez na VPS; a privada vai para GitHub Actions como secret, sem transitar pelo chat nem ser copiada para a VPS. Verificar a chave pública/host key por canal administrativo independente; não confiar apenas em `ssh-keyscan`.
2. Em GitHub → Settings → Environments, criar `sana-lab` e restringir à branch `sana-lab-exumacao-f0-f2`. Proteger essa branch com revisão de mudanças e limitar quem pode alterá-la: o deploy executa código dessa branch como root **apenas na VPS LAB**. Configurar os nomes abaixo como secrets/variables do environment (ou secrets do repositório se o plano não disponibilizar environment secrets):

   | Tipo | Nome | Conteúdo esperado |
   |---|---|---|
   | Secret | `SANA_LAB_DEPLOY_SSH_KEY` | Chave privada exclusiva de deploy SSH |
   | Secret | `SANA_LAB_SSH_KNOWN_HOSTS` | Entrada `known_hosts` verificada para o host SSH existente |
   | Variable | `SANA_LAB_DEPLOY_HOST` | Nome DNS do SSH já usado pela VPS |
   | Variable | `SANA_LAB_DEPLOY_USER` | `sana-lab-deploy` |

   **Não criar `SANA_LAB_TOKEN` no GitHub.** O token Bearer existente permanece apenas no secret montado no container e na credencial n8n já existente.
3. Na VPS, como administrador, atualizar o checkout da branch LAB, conferir o SHA completo do release e instalar os dois wrappers root-owned e a chave **pública** via:

   ```bash
   cd /docker/sana-lab-bridge-src
   git fetch origin sana-lab-exumacao-f0-f2
   git switch sana-lab-exumacao-f0-f2
   git merge --ff-only FETCH_HEAD
   git status --porcelain
   git rev-parse HEAD
   bash sana-lab/bootstrap-deploy-access.sh /caminho/privado/sana-lab-deploy.pub
   ```

   `git status --porcelain` deve estar vazio; o SHA deve coincidir com o commit publicado. O bootstrap cria a conta `sana-lab-deploy` com marcador de senha inválido `NP` (permite chave pública, sem senha utilizável), instala **somente** a chave pública com `restrict` e forced command, e autoriza no sudo exclusivamente `/usr/local/sbin/sana-lab-deploy-entry`. Instala também uma cópia root-owned do script de deploy; o entrypoint rejeita releases que alterem esse script até uma nova revisão/bootstrap explícita. Ele não abre firewall, não cria serviço público nem executa deploy por si. A conta não entra no grupo `docker`.

## Acionamento, evidência e limites

- Normal: publicar commit na branch LAB (arquivos afetados pelo workflow). Acompanhar GitHub Actions → **SANA LAB — deploy bridge privada** → `validate` → `deploy`; o SSH exibe apenas versão/hash/status. Depois conferir `docker inspect sana-lab-bridge` e `/var/lib/sana-lab-deploy/active.txt` na VPS se houver incidente. Um commit já superado na branch é rejeitado antes da troca.
- Rollback sintético pela própria branch LAB: criar um commit cujo assunto seja exatamente `[sana-lab-rollback-test]` e que modifique um arquivo incluído no filtro `push` (por exemplo, este documento). O job valida o mesmo commit, implanta temporariamente a imagem, força uma falha **depois** do probe, restaura a bridge anterior e exige `ROLLBACK_CONFIRMED=YES`, sem `DEPLOY_OK`. Depois, um commit normal aciona o deploy habitual. O `workflow_dispatch` também aceita `mode=rollback-test` **quando este workflow estiver presente na branch padrão**; não é necessário alterar `main` para provar rollback via `push`.
- Baseline da prova controlada: run `36023834176` implantou o commit `079eaa43a7d4ff105a03a467320118d364079c09` como `sana-lab-bridge:079eaa43a7d4`. O rollback deve confirmar que esta imagem retorna à operação.
- Resultado da prova controlada: run `36038598654`, commit `452efc872e746b94691e1a184be67da8a9cb366a`; imagem temporária `sana-lab-bridge:452efc872e74`, probe HTTP 200, falha sintética após o probe e `ROLLBACK_CONFIRMED=YES` para a imagem `sana-lab-bridge:079eaa43a7d4` (mesmo image ID do baseline). A troca usa os mesmos mounts LAB e não publica portas. O commit documental seguinte aciona deploy normal para alinhar o runtime ao HEAD.
- Recuperação manual excepcional: como administrador da VPS, usar o mesmo script do checkout limpo `bash sana-lab/deploy-functional-gate.sh <SHA_ATUAL> deploy` para avançar. Se a bridge não partir, preservar `/lab-state` e o secret e examinar `docker inspect sana-lab-bridge`; para voltar a um backup parado, interromper o novo container, renomear o backup `sana-lab-bridge-before-...` para `sana-lab-bridge` e iniciá-lo, depois conferir imagem, hashes, rede e HTTP 401. Não apagar backup nem volume LAB durante o diagnóstico.

**Gate operacional:** código, testes locais e workflow publicado não comprovam SSH configurado, execução real do Actions ou rollback na VPS. Exigir IDs de runs, imagem/commit/hash ativos e rollback controlado real antes de `DEPLOY_AUTOMATION=PASS`. Isto tampouco homologa operações oficiais ou atendimento completo.
