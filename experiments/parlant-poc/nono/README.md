# Laboratorio Parlant sob sandbox Nono (Windows/WSL2)

Este diretorio existe para tirar do GitHub Actions tudo que nao precisa do
Gemini real. A suite offline, a inspecao do schema das Tools e a bateria
sintetica rodam inteiras na maquina local; o Actions passa a ser usado so para
o que exige a chave.

O sandbox e o [nono](https://github.com/nolabs-ai/nono) (Landlock + seccomp).
O objetivo do perfil e simples: **o laboratorio pode escrever em
`experiments/parlant-poc` e ler o catalogo `santana-conversation-domain`; nada
mais.** Sem rede, sem chave, sem token, sem credencial de nuvem.

## 1. Instalacao (Windows -> WSL2)

O nono e Linux/macOS. No Windows ele roda **dentro do WSL2**, nunca no
PowerShell nativo. Instale na distro WSL2 onde o repositorio esta clonado:

```bash
# Ubuntu/Debian em WSL2
VERSION=$(curl -sIL https://github.com/nolabs-ai/nono/releases/latest \
  | grep -i location | grep -oP 'v\K[0-9a-zA-Z.-]+')
ARCH=$(dpkg --print-architecture)
wget https://github.com/nolabs-ai/nono/releases/download/v${VERSION}/nono-cli_${VERSION}_${ARCH}.deb
sudo dpkg -i nono-cli_${VERSION}_${ARCH}.deb
nono --version
```

Homebrew (`brew install nono`) tambem funciona em WSL2 se voce ja usa linuxbrew.

Depois, confira o que o seu kernel suporta — isso decide quais alvos deste
laboratorio rodam:

```bash
nono setup --check-only
```

Guarde a linha do **Landlock ABI**. Ela e a diferenca entre rodar metade e
rodar tudo (secao 5).

Mantenha o repositorio no filesystem do Linux (`~/...`, ou seja `ext4`), nao em
`/mnt/c`. O Landlock nao aplica bem sobre o 9p/DrvFs do Windows, e o desempenho
do Python cai muito.

## 2. Validar o perfil antes de usar

```bash
nono profile validate ./experiments/parlant-poc/nono/santana-parlant-lab.jsonc
nono profile show     ./experiments/parlant-poc/nono/santana-parlant-lab.jsonc
```

`nono profile show` imprime o perfil ja resolvido (com `default` mesclado e as
variaveis expandidas): e ali que voce confere que `$WORKDIR` virou a raiz certa
do repositorio.

Se o nono ainda nao estiver instalado, `nono/validar_perfil.py` faz a mesma
checagem usando o `nono-profile.schema.json` e o `policy.json` publicados pelo
projeto — util em CI ou em container sem nono:

```bash
# o proprio nono publica o schema; o policy.json vem da instalacao e e opcional
nono profile schema > /tmp/nono-schema.json
.venv/bin/python nono/validar_perfil.py /tmp/nono-schema.json
```

Ele confere tres coisas que ja mordem na pratica: campo fora do schema; `$VAR`
que o nono nao expande (nao existe `${REPO}`, e chaves `${}` nao sao aceitas);
e nome de grupo inexistente — `system_read_linux` passa no schema mas nao
existe, o nome real e `system_read_linux_core`.

### 2.1 Provar o filtro de ambiente sem o Nono

`nono/ambiente_do_perfil.py` aplica so o pedaco do perfil que da para reproduzir
fora do sandbox — a filtragem de variaveis, com a mesma precedencia do Nono
(`deny_vars` vence `allow_vars`, e `allow_vars` fecha o resto):

```bash
.venv/bin/python nono/ambiente_do_perfil.py --mostrar
.venv/bin/python nono/ambiente_do_perfil.py -- .venv/bin/python -m pytest -q
```

Serve para provar que a suite offline nao depende de nenhuma chave. **Nao**
substitui o Nono: filesystem e rede continuam sem enforcement fora dele.

## 3. Rodar

Sempre **a partir da raiz do repositorio**: o nono expande `$WORKDIR` com o
diretorio de onde ele proprio foi lancado, e o perfil declara os caminhos a
partir dali. O wrapper recusa rodar de outro lugar.

```bash
bash experiments/parlant-poc/nono/lab.sh provas        # provas 1-5 do sandbox
bash experiments/parlant-poc/nono/lab.sh offline       # suite pytest
bash experiments/parlant-poc/nono/lab.sh schema        # inspecao do schema real
bash experiments/parlant-poc/nono/lab.sh sintetico 20  # bateria sintetica curta
bash experiments/parlant-poc/nono/lab.sh determinismo  # duas execucoes iguais
```

`provas` e `offline` usam o perfil puro (rede negada). `schema`, `sintetico` e
`determinismo` acrescentam `--open-port` — ver secao 5.

## 4. O que o perfil concede e o que nega

| | |
|---|---|
| **Escrita** | `experiments/parlant-poc` (e so ele) |
| **Leitura** | `santana-conversation-domain` (o catalogo autoritativo) |
| **Leitura** | runtime de Python do sistema e do usuario (`system_read_linux_core`, `python_runtime`) |
| **Nega** | todo o resto do repositorio: `.git`, `.github`, `database`, `edge-functions`, `contracts`, `docs`, `tests` |
| **Nega** | `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.kube`, `~/.docker`, `~/.netrc`, `~/.git-credentials` (grupo `deny_credentials`) |
| **Nega** | `~/.config/gh`, `~/.claude`, `~/.claude.json`, `~/.gitconfig`, `~/.supabase`, `~/.n8n`, `~/.vercel` |
| **Nega** | historico e configuracao de shell, dados de navegador, keyrings |
| **Nega** | rede: `network.block` — o seccomp so deixa passar `AF_UNIX` |
| **Nega** | variaveis de ambiente: `GEMINI_API_KEY`, `PARLANT`, `GOOGLE_*`, `ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*`, `GH_*`, `GITHUB_*`, `SUPABASE_*`, `N8N_*`, `W_API_*`/`WAPI_*`, `VERCEL_*`, `AWS_*`, `AZURE_*`, `GCP_*` e todos os `*_PROXY` |

O `allow_vars` e uma allow-list: o que nao esta listado nao entra, mesmo que
nao apareca no `deny_vars`. O `deny_vars` existe para o caso de alguem alargar
a allow-list depois — deny vence allow.

`TMPDIR` e redirecionado para `experiments/parlant-poc/.nono-tmp`, porque `/tmp`
nao foi concedido e todos os scripts criam o `PARLANT_HOME` com
`tempfile.mkdtemp()`. O `PARLANT_HOME` de proposito **nao** e fixado no perfil:
fixa-lo faria os scripts reaproveitarem o mesmo diretorio entre execucoes e
traria de volta o bug do `evaluation_cache.json` velho congelando a Journey.

`.nono-tmp` e descartavel e esta no `.gitignore`: cada execucao deixa ali um
`PARLANT_HOME` novo. Apague o diretorio inteiro quando quiser.

## 5. Incompatibilidades conhecidas (leia antes de reclamar)

### 5.1 Loopback TCP: o Parlant precisa, o `block` derruba

O Parlant sobe as Tools num `PluginServer` HTTP e o engine fala com ele por
`127.0.0.1`. O `network.block` do nono instala um filtro seccomp que so permite
`socket(AF_UNIX)` — ou seja, derruba **tambem** o loopback. Com o perfil puro,
`scripts/inspect_tool_schema.py`, a bateria sintetica e o determinismo nao
sobem.

A excecao correta e `--open-port` (o `lab.sh` ja passa 8803, 8860, 8861, 8880),
e ela exige **Landlock ABI V4+ (kernel 6.7+)**. O kernel padrao do WSL2 e o
6.6 (Landlock V3), e nesse caso o nono **falha fechado** — recusa rodar em vez
de silenciosamente liberar a rede. Isso e o comportamento certo, nao um defeito.

Consequencia pratica no WSL2 padrao:

| Alvo | Kernel WSL2 padrao (6.6 / V3) | Kernel rolling (6.7+ / V4+) |
|---|---|---|
| `provas` (1-5) | roda | roda |
| `offline` (pytest) | roda | roda |
| `schema` | **nao roda** | roda |
| `sintetico` / `determinismo` | **nao roda** | roda |

Para liberar os tres ultimos, instale o
[WSL2-Linux-Kernel-Rolling](https://github.com/Nevuly/WSL2-Linux-Kernel-Rolling)
e aponte `kernel=` no `%USERPROFILE%\.wslconfig`, depois `wsl --shutdown`.
Confirme com `nono setup --check-only` que o Landlock subiu para V4 ou mais.

Um aviso honesto sobre `--open-port`: a regra do Landlock casa **porta**, nao
endereco. Conceder 8803 permite 8803 em qualquer destino, nao so em
`127.0.0.1`. Como o Gemini e o Supabase falam em 443, e 443 nunca e concedido,
isso nao abre o caminho que este laboratorio precisa manter fechado — mas e uma
folga real e esta registrada aqui de proposito.

### 5.2 Git nao funciona dentro do sandbox

`.git` esta em `filesystem.deny`. Isso e intencional: o agente do laboratorio
nao commita nem reescreve historico. Faca `git add`/`commit`/`push` **fora** do
`nono run`, na sessao normal do WSL2.

### 5.3 Claude Code dentro do sandbox

Rodar o proprio Claude Code sob este perfil nao funciona como esta: ele precisa
de `~/.claude`, `~/.claude.json` e de rede para a API — os tres negados de
proposito, porque a chave do agente e exatamente o tipo de segredo que nao pode
vazar para dentro do laboratorio. O uso previsto e o inverso: o Claude Code roda
fora e invoca `nono run` para executar os testes. Se um dia for necessario rodar
o agente por dentro, isso exige um segundo perfil, com proxy de dominio para a
API da Anthropic — e ai o WSL2 tem a limitacao 5.4.

### 5.4 Proxy de credenciais e elevacao de capacidade nao funcionam no WSL2

O PID 1 do WSL2 ja registrou o unico listener de `SECCOMP_RET_USER_NOTIF`
permitido pelo kernel, entao `--capability-elevation` e o modo proxy-only
(`--credential`, `--network-profile`, `--allow-domain`) retornam `EBUSY`. O nono
recusa o modo proxy-only por padrao no WSL2 em vez de rodar sem enforcement.
Este laboratorio nao usa nenhum dos dois — `network.block` e totalmente
aplicado pelo kernel em qualquer versao.

### 5.5 `io_uring` desativado

O filtro de rede tambem nega `io_uring_setup()`. Nenhuma dependencia da POC usa
io_uring, mas se um dia o pytest ou o Parlant passarem a usar, o sintoma sera um
`EPERM` que nao parece ter relacao com rede.
