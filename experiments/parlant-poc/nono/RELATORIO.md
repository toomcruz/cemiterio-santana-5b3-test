# Relatorio — Fase 0: fechar e congelar o laboratorio

Data: 2026-08-18. Branch `claude/parlant-poc-gemini-bjab09`.
Sem Gemini, sem secret, sem producao, sem merge.

## 1. Instalacao necessaria

O nono e Linux/macOS; no Windows roda **dentro do WSL2**. O procedimento esta em
[`README.md`](README.md) secao 1 (pacote `.deb` da release oficial, ou Homebrew).

**O nono nao pode ser instalado no container remoto onde esta POC e montada.**
Os tres caminhos de instalacao sao bloqueados pelo proxy de saida:

| Caminho | Resultado |
|---|---|
| `curl https://nono.sh/install.sh` | `CONNECT tunnel failed, response 403` |
| `api.github.com/repos/nolabs-ai/nono/releases/latest` | 403 |
| `cargo install` (crates.io) | 403 |

Por isso o estudo foi feito **no codigo-fonte** (clone do repositorio em
`e416f9c`, 2026-08-17): `crates/nono-cli/data/nono-profile.schema.json`,
`crates/nono-cli/data/policy.json`, `crates/nono/src/sandbox/linux.rs` e as
paginas de docs de profiles, networking e WSL2. Todas as afirmacoes tecnicas
deste relatorio vem da fonte, nao de suposicao.

**Consequencia honesta:** o perfil esta escrito e validado, mas o *enforcement*
do nono nao pode ser exercitado aqui. Quem executa `lab.sh` pela primeira vez e
a sua maquina WSL2.

## 2. Perfil criado

[`santana-parlant-lab.jsonc`](santana-parlant-lab.jsonc), validado contra o
`nono-profile.schema.json` e o `policy.json` reais por
[`validar_perfil.py`](validar_perfil.py) — `PASS`.

Dois erros do rascunho anterior so apareceriam na hora de rodar e foram
corrigidos:

* `${REPO}` nao existe. O nono expande apenas `~`, `$HOME`, `$WORKDIR`,
  `$TMPDIR`, `$UID`, `$XDG_*`, `$NONO_CONFIG`, `$NONO_PACKAGES`, e **nao aceita
  chaves** `${}` (`crates/nono-cli/src/profile/mod.rs::expand_vars`). Um
  `${REPO}/...` viraria caminho literal e concederia nada.
* `system_read_linux` nao existe; o nome real e `system_read_linux_core`. Passa
  no schema e falha so na resolucao de grupos.

O validador agora trava as duas coisas, alem do schema.

## 3. Permissoes concedidas

| Alvo | Acesso |
|---|---|
| `experiments/parlant-poc` | leitura + **escrita** (unico lugar gravavel) |
| `santana-conversation-domain` | leitura |
| runtime Python (`~/.pyenv`, `~/.local/lib`, `~/.local/share/uv`, `~/.conda`) | leitura |
| `/usr`, `/etc`, `/lib` etc. (`system_read_linux_core`) | leitura |
| `TMPDIR` -> `experiments/parlant-poc/.nono-tmp` | escrita (dentro do laboratorio) |

`workdir.access` e `none`: o cwd de lancamento (a raiz do repositorio) **nao** e
concedido. Cada caminho e explicito.

## 4. Permissoes negadas

| Alvo | Motivo |
|---|---|
| `.git`, `.github` | o laboratorio nao commita nem edita workflow |
| `database`, `edge-functions`, `contracts`, `docs`, `tests` (raiz) | caminho de producao |
| `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker`, `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.vault-token`, `~/.pki` | grupo `deny_credentials` |
| `~/.config/gh`, `~/.claude`, `~/.claude.json`, `~/.gitconfig`, `~/.supabase`, `~/.n8n`, `~/.vercel` | token do GitHub e credenciais de produto |
| historico/config de shell, dados de navegador, keyrings | grupos do perfil `default` |
| **toda a rede** | `network.block: true` |
| `GEMINI_API_KEY`, `PARLANT`, `GOOGLE_*`, `ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*`, `GH_*`, `GITHUB_*`, `SUPABASE_*`, `N8N_*`, `W_API_*`, `WAPI_*`, `VERCEL_*`, `AWS_*`, `AZURE_*`, `GCP_*`, `*_PROXY` | `deny_vars`; e `allow_vars` fecha tudo que nao esta listado |

Supabase, n8n, W-API, Vercel e Gemini estao negados por tres vias
independentes: nao ha rede, nao ha variavel de ambiente e nao ha credencial em
disco.

## 5. Prova de zero rede

Duas evidencias, uma de codigo e uma de execucao.

**Codigo.** `network.block` instala o filtro seccomp construido em
`crates/nono/src/sandbox/linux.rs`: no `socket()`, so `AF_UNIX` retorna
`SECCOMP_RET_ALLOW`; `AF_INET` e `AF_INET6` caem no ramo de erro, junto com
`io_uring_setup()`. Nao e filtragem por destino — e recusa de criar socket IP.

**Execucao.** A bateria sintetica de 300 conversas rodou com o `NetworkGuard`
da POC ativo e reportou `rede.external_network_calls = 0`, com a lista de
tentativas vazia.

O controle e a parte que fecha o argumento: rodando **sem** o nono, neste
container, `validar_sandbox.py` **falha** as provas 3, 4 e 5 — le
`.git/HEAD`, `.github/workflows`, `database/`, escreve na raiz do repositorio,
conecta em `generativelanguage.googleapis.com:443` e em `api.github.com:443`.
As sondas detectam a ausencia do sandbox; nao sao asserts vazios.

## 6. Prova de ausencia de secrets

`ambiente_do_perfil.py` aplica o filtro de variaveis do perfil com a mesma
precedencia do nono (`deny_vars` > `allow_vars` > resto). Neste container o
ambiente cai de **132 para 12 variaveis**:

```
HOME  LC_CTYPE  NO_PROXY  PATH  PIP_CERT  PWD
PYTHONDONTWRITEBYTECODE  PYTHONUNBUFFERED  SHELL  TERM  TMPDIR  no_proxy
```

Somem `GH_TOKEN`, `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCESS_KEY_ID`,
`ANTHROPIC_BASE_URL`, `HTTPS_PROXY` e todo o bloco `CLAUDE_CODE_*`. A suite
offline completa passa nesse ambiente — ou seja, **nada no laboratorio depende
de segredo**.

Nenhum valor de variavel foi impresso em nenhum momento; o relatorio diz que a
variavel existe, nunca o que ela contem.

Limite honesto: a leitura de `~/.claude.json` **continua possivel** sem o nono.
O filtro de ambiente e reproduzivel fora do sandbox; o filesystem nao e. Essa
metade so fica provada quando `lab.sh` rodar na sua maquina.

## 7. Testes executados

| # | Prova | Resultado | Tempo |
|---|---|---|---|
| 1 | agente le o laboratorio e o catalogo | PASS | — |
| 2 | agente executa Python, Parlant 3.3.2 e pytest | PASS | — |
| 3 | agente nao alcanca nada fora do escopo | **nao verificavel aqui** (sem nono) | — |
| 4 | rede externa negada | **nao verificavel aqui** (sem nono); `external_network_calls = 0` na bateria | — |
| 5 | nenhuma chave disponivel | PASS com o filtro do perfil aplicado (132 -> 12 vars) | 7,5 s |
| 6 | suite offline (191 testes) | **PASS** | 5,1 s |
| 7 | inspecao runtime do schema real Parlant/ToolCaller | **PASS** — "tools cujo schema se perde no caminho: nenhuma" | 4,7 s |
| 8 | bateria sintetica curta (20 conversas / 50 turnos) | **PASS** | 126,8 s |
| — | bateria sintetica completa (300 conversas / 1059 turnos) | **PASS** | 1183 s (19m43s) |
| — | determinismo (120 x 2) | **PASS** | 599 s (297 s + 302 s) |

Bateria completa, numeros que importam:

```
conversas .................. 300        turnos ..................... 1059
turnos_com_erro ............ 0          turnos_com_resposta ........ 1059
casamento de guidelines .... 573/573    acuracia ................... 1.0
falsos positivos ........... 0          falsos negativos ........... 0
chamadas externas .......... 0          contaminacao entre sessoes . 0
preco/documento/prazo/procedimento inventado ....... 0 / 0 / 0 / 0
fato autoritativo confirmado indevidamente ......... 0
avanco sem autoridade ...... 0          tool proibida .............. 0
injection bypass ........... 0          bloqueadores ............... nenhum
```

Determinismo: as duas execucoes com a mesma seed (20260817) coincidem no que
importa.

## 8. PASS/FAIL

**PASS** no que era verificavel neste ambiente: provas 1, 2, 5 (com filtro), 6,
7, 8, bateria completa e determinismo.

**Nao verificavel aqui:** provas 3 e 4 no nivel do kernel, porque o nono nao
instala neste container. O perfil esta escrito, validado contra o schema real e
coberto por 31 testes de regressao; falta so executa-lo.

## 9. Tempo de execucao

Trabalho local total: ~40 min de maquina, dos quais 19m43s de bateria completa e
10m de determinismo. **Zero minuto de GitHub Actions** para esses resultados —
que era o objetivo da etapa.

## 10. Incompatibilidades entre Nono e Parlant/Claude Code

1. **Loopback TCP vs. `network.block`.** O Parlant sobe as Tools num
   `PluginServer` HTTP e o engine fala com ele por `127.0.0.1`. O `block`
   derruba tambem o loopback. A excecao e `--open-port`, que exige **Landlock
   V4+ (kernel 6.7+)**; o kernel padrao do WSL2 e 6.6 (V3) e o nono **falha
   fechado**. No WSL2 padrao: `provas` e `offline` rodam; `schema`,
   `sintetico` e `determinismo` nao. Solucao: kernel rolling (README 5.1).
   **Isto nao e pre-requisito para implantar o Parlant** — e so a condicao para
   rodar esses tres alvos *sob sandbox* nesta maquina.
2. **`--open-port` casa porta, nao endereco.** Conceder 8803 permite 8803 em
   qualquer destino. Como 443 nunca e concedido, o caminho que importa segue
   fechado — mas e uma folga real.
3. **Git nao funciona dentro do sandbox** (`.git` negado, de proposito).
   Commit e push acontecem fora do `nono run`.
4. **Claude Code nao roda sob este perfil**: precisa de `~/.claude`,
   `~/.claude.json` e rede. O uso previsto e o inverso — o agente roda fora e
   chama `nono run` para executar os testes.
5. **Proxy de credenciais e elevacao de capacidade sao indisponiveis no WSL2**
   (o PID 1 do WSL2 ja tomou o unico listener de `SECCOMP_RET_USER_NOTIF`).
   Este laboratorio nao usa nenhum dos dois.
6. **`io_uring_setup()` negado** junto com a rede. Nenhuma dependencia atual
   usa, mas o sintoma futuro seria um `EPERM` sem cara de rede.

## 11. Estado congelado

A POC sintetica esta congelada neste ponto. Baterias pesadas nao serao repetidas
sem mudanca material no comportamento. As workflows `parlant-synthetic.yml`,
`parlant-poc-lab.yml` e `parlant-full-poc-gemini.yml` rodam **somente** por
`workflow_dispatch`.
