#!/usr/bin/env bash
# Orquestrador do laboratorio Parlant sob o Nono (Windows/WSL2).
#
# Rode SEMPRE a partir da raiz do repositorio: o Nono expande `$WORKDIR` com o
# diretorio de onde ele proprio foi lancado, e o perfil declara os caminhos a
# partir dali. Rodar de outro lugar concederia os diretorios errados.
#
#   bash experiments/parlant-poc/nono/lab.sh provas      # 1-5 (rede negada)
#   bash experiments/parlant-poc/nono/lab.sh offline     # 6   (rede negada)
#   bash experiments/parlant-poc/nono/lab.sh schema      # 7   (precisa loopback)
#   bash experiments/parlant-poc/nono/lab.sh sintetico N # 8   (precisa loopback)
#   bash experiments/parlant-poc/nono/lab.sh determinismo
#   bash experiments/parlant-poc/nono/lab.sh tudo
#
# Nenhum alvo usa o Gemini e nenhum precisa de segredo.
set -Eeuo pipefail

RAIZ="$(pwd)"
PERFIL="./experiments/parlant-poc/nono/santana-parlant-lab.jsonc"
LAB="experiments/parlant-poc"
PY=".venv/bin/python"

# Portas de loopback do PluginServer do Parlant, conferidas contra os defaults
# dos scripts: sintetica 8803 (runner.py), determinismo 8860/8861
# (check_determinism.py), inspecao de schema 8880 (inspect_tool_schema.py).
PORTAS=(8803 8860 8861 8880)

if [[ ! -f "${RAIZ}/${PERFIL#./}" ]]; then
  echo "erro: rode a partir da raiz do repositorio (nao encontrei ${PERFIL})" >&2
  exit 2
fi

abrir_portas() {
  local args=()
  for porta in "${PORTAS[@]}"; do args+=(--open-port "${porta}"); done
  printf '%s\n' "${args[@]}"
}

# `sem_rede`: perfil puro. Vale em qualquer kernel WSL2.
sem_rede() { nono run --profile "${PERFIL}" -- "$@"; }

# `com_loopback`: mesmo perfil + excecao de porta. Landlock V4+ (kernel 6.7+).
# No kernel padrao do WSL2 (6.6 / Landlock V3) o Nono FALHA FECHADO aqui — e
# esse e o comportamento correto, nao um bug. Ver nono/README.md.
com_loopback() {
  mapfile -t portas < <(abrir_portas)
  nono run --profile "${PERFIL}" "${portas[@]}" -- "$@"
}

alvo="${1:-tudo}"
shift || true

case "${alvo}" in
  provas)
    sem_rede bash -c "cd ${LAB} && mkdir -p .nono-tmp && ${PY} nono/validar_sandbox.py --json .nono-tmp/provas-sandbox.json"
    ;;
  offline)
    sem_rede bash -c "cd ${LAB} && mkdir -p .nono-tmp && ${PY} -m pytest -q"
    ;;
  schema)
    com_loopback bash -c "cd ${LAB} && mkdir -p .nono-tmp && ${PY} -u scripts/inspect_tool_schema.py"
    ;;
  sintetico)
    n="${1:-20}"
    com_loopback bash -c "cd ${LAB} && mkdir -p .nono-tmp && SYNTHETIC_CONVERSATIONS=${n} ${PY} -u scripts/run_synthetic_validation.py"
    ;;
  determinismo)
    n="${1:-120}"
    com_loopback bash -c "cd ${LAB} && mkdir -p .nono-tmp && SYNTHETIC_CONVERSATIONS=${n} ${PY} -u scripts/check_determinism.py"
    ;;
  tudo)
    bash "$0" provas
    bash "$0" offline
    bash "$0" schema
    bash "$0" sintetico 20
    ;;
  *)
    echo "alvo desconhecido: ${alvo}" >&2
    exit 2
    ;;
esac
