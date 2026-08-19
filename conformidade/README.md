# Conformidade — contratos compartilhados

Nada aqui pertence a uma implementação. A referência Python e o Gateway TS/Deno
leem **estes mesmos arquivos**, e é isso que dá sentido à comparação entre elas.

| | |
| --- | --- |
| `vetores/` | Os 47 casos de V1–V12, em formato neutro. Especificação em `vetores/FORMATO.md` |
| `vetores/fixtures/` | Catálogos-fixture, isolados dos dados autoritativos |
| `perfis/exumacao.v1.json` | Escopo técnico do assunto EXUMAÇÃO |
| `comparar.py` | Comparador entre implementações |

## O perfil não é fonte autoritativa

`perfis/exumacao.v1.json` declara **quais fatos do catálogo de domínio pertencem
ao escopo técnico** do assunto — nada além disso. Ele não declara regra, preço,
documento nem prazo. Por isso vive aqui e **não** em `santana-authority/`.

Ele existe porque a lista era, antes, uma constante em Python que o Gateway
TS/Deno teria de duplicar. Duas cópias divergiriam em silêncio, e nenhum vetor
pegaria — porque nenhum vetor exercita os 15 fatos de recadastro, comercial e
reclamação. Há teste, nas duas implementações, exigindo que a lista venha daqui.

## Regra que não se negocia

**Nenhum vetor é alterado para fazer uma implementação passar.** Se uma
implementação diverge do vetor, corrige-se a implementação — inclusive quando a
implementação é a de referência.

## Como comparar

```
VETORES_RELATORIO=/tmp/rel-py.json VETORES_DESPEJO=/tmp/dump-py.json \
  python3 referencia/runner/executar_vetores.py

VETORES_RELATORIO=/tmp/rel-ts.json VETORES_DESPEJO=/tmp/dump-ts.json \
  deno run --allow-env --allow-read --allow-write --allow-sys \
    santana-authority-gateway/conformidade/executar_vetores.ts

python3 conformidade/comparar.py \
  --relatorio referencia=/tmp/rel-py.json --relatorio ts=/tmp/rel-ts.json \
  --despejo   referencia=/tmp/dump-py.json --despejo   ts=/tmp/dump-ts.json
```

O modo com `--despejo` compara a **saída real canonizada** de cada caso, byte a
byte, sem passar pelo esperado. É ele que pega deriva de formato em campo que
nenhum vetor cobre hoje.
