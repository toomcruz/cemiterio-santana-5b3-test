# Relatório da Fase 3 — Gateway definitivo TS/Deno

```
STATUS: IMPLEMENTADO · 47/47 PASS NAS DUAS IMPLEMENTACOES · SAIDA IDENTICA BYTE A BYTE
CI:     BLOCKED_BY_ACTIONS_QUOTA  (nao e FAIL de implementacao)
NAO INICIA A FASE 4.
```

Base: `origin/main` `119c14f`. Nenhuma chamada NVIDIA, nenhuma chamada Gemini,
nenhuma rede em teste. Parlant runtime, n8n, W-API, Supabase e produção
intocados.

## 1. Estrutura final

```
santana-authority/            dados autoritativos      (nao pertence a implementacao)
  catalogo/exumacao.v1.json

conformidade/                 contratos compartilhados (nao pertence a implementacao)
  vetores/                    47 casos V1-V12 + FORMATO.md
  vetores/fixtures/           catalogos-fixture, isolados
  perfis/exumacao.v1.json     escopo tecnico do assunto
  comparar.py                 comparador entre implementacoes

referencia/                   implementacao de referencia (Python)
santana-authority-gateway/    runtime definitivo (TS/Deno)
```

Decisões A, B e C aplicadas integralmente.

## 2. Arquivos criados e alterados

**Movidos, sem alteração de conteúdo:** `referencia/vetores/` →
`conformidade/vetores/` (registrado pelo git como *rename*).

**Criados — `santana-authority-gateway/`:** `caminhos.ts` · `canonico.ts` ·
`catalogo/erros.ts` · `catalogo/carregar.ts` · `dominio/catalogo.ts` ·
`resposta.ts` · `consulta.ts` · `argumentos.ts` · `caso.ts` · `escrita.ts` ·
`gateway.ts` · `conformidade/executar_vetores.ts` · `tests/conformidade_test.ts`
· `tests/garantias_test.ts` · `README.md`.

**Criados — compartilhados:** `conformidade/perfis/exumacao.v1.json` ·
`conformidade/comparar.py` · `conformidade/README.md`.

**Alterados:** `referencia/santana_referencia/dominio/catalog.py` (escopo passa a
vir do perfil) · `referencia/runner/executar_vetores.py` (caminho dos vetores,
symlink de `conformidade`, modo despejo) ·
`referencia/tests/test_invariantes_dominio.py` · `.github/workflows/shadow-static.yml`.

## 3. `release_id` calculado pelo TS

```
exu-1.0-32cc48f26797
```

Idêntico ao da referência e ao da C1 real da Fase 1B. Fechou na primeira
execução. Há teste dedicado (`garantias_test.ts`), porque um erro de um byte ou
de ordem de concatenação aqui transformaria **todos** os vetores em `INVÁLIDO`.

## 4. Resultado TS/Deno — V1 a V12

```
CASOS: 47   PASS: 47   FAIL: 0   INVALIDO: 0
V1 V2 V3 V4 V5 V6 V7 V8 V9 V10 V11 V12  ->  todos PASS
```

Relatório completo: `docs/fase3/resultado-vetores-ts.json`.

## 5. Resultado Python — V1 a V12

```
CASOS: 47   PASS: 47   FAIL: 0   INVALIDO: 0
```

Relatório completo: `docs/fase3/resultado-vetores-referencia.json`.

## 6. Comparação byte a byte

```
CONFORMIDADE: IDENTICA (referencia x ts)
  casos: 47  PASS: 47  FAIL: 0  INVALIDO: 0
  saida real comparada byte a byte em 47 casos: identica
```

Os dois executores emitem, além do relatório, um **despejo** com a saída real
canonizada de cada caso — sem passar pelo esperado. Os dois arquivos são
literalmente o mesmo conteúdo:

```
sha256  3e37136e6d15a49008278f84e4704785756052eed1f1f36d3f25b0967682fca2
```

Sendo honesto sobre o que cada exigência prova: como a comparação de cada caso
contra o esperado já é **total**, dois PASS implicam saídas iguais. As demais
exigências do comparador servem para pegar caso ausente, `INVÁLIDO` e exceção —
situações em que uma implementação não chega a comparar nada. O despejo é o que
compara o que cada uma realmente emitiu, e é ele que pegaria deriva de formato
em campo que nenhum vetor cobre hoje.

## 7. Testes locais

| Suíte | Resultado |
| --- | --- |
| `santana-authority-gateway/tests` | **22 passed, 0 failed** |
| `referencia/tests` | **25 passed, 0 failed** |
| `tests/unit` + `tests/shadow` | 23 passed, 0 failed |
| `santana-conversation-domain/tests/p0` | 26 passed, 0 failed |
| `santana-conversation-domain/runtime/tests` | 60 passed, 0 failed |

Os testes do Gateway cobrem duas famílias distintas. **Conformidade**: os 47
casos passam, e quatro testes provam que o executor consegue reprovar (saída
diferente, chave extra, escrita inesperada, `release_id` divergente como
`INVÁLIDO` e nunca `PASS`). **Garantias estruturais**: o que nenhum vetor prova
sozinho — ausência de literal de tarifa ou modalidade no código, ausência de
coerção numérica sobre dinheiro, ausência de `Date`, ordenação por code point
(inclusive fora do BMP), ordenação de chaves na canonização, escopo vindo do
perfil compartilhado, ausência de segunda lista de `fact_codes`, e catálogo
oficial em caminho neutro.

## 8. `deno fmt`, `lint`, `check`

Executados com **Deno 2.1.4**, a versão exata que a CI usa.

```
actionlint v1.7.7 ......... PASS
deno fmt --check .......... PASS   (125 arquivos, agora incluindo o Gateway)
deno lint ................. PASS
deno check ................ PASS   (gateway.ts e executar_vetores.ts incluidos)
gerados sincronizados ..... PASS
postgres estatico ......... PASS
```

## 9. PR

Aberto sobre `origin/main` `119c14f`, sem merge.

## 10. Status do CI

```
BLOCKED_BY_ACTIONS_QUOTA
```

A conta está sem minutos incluídos até 01/09/2026. **Isto não é FAIL de
implementação.** O `static` continua sendo critério e continua obrigatório para
o merge; nada foi removido nem afrouxado do job — ao contrário, ele ganhou
quatro passos novos (vetores TS, testes do Gateway, comparação Python × TS, e o
Gateway incluído em `fmt`/`lint`/`check`).

O que foi feito no lugar: reproduzir localmente o job `static` inteiro, com a
versão pinada do Deno e do actionlint. **Teste local não substitui o `static`**
— ele antecipa o resultado, e a confirmação real só existe quando o Actions
voltar a executar.

## 11. Divergências encontradas e como foram corrigidas

Nenhuma divergência de **saída** entre as implementações sobreviveu. As três
correções abaixo foram no código, nunca no vetor.

| # | Divergência | Correção |
| --- | --- | --- |
| 1 | O perfil de conformidade nasceu como `exumacao.v1.json` e colidiu com o nome do catálogo oficial, reprovando o teste de cópia única | O teste é que estava fraco: casava por **nome de arquivo**. Passou a identificar catálogo por **conteúdo** (`schema_version` + `tipos_de_informacao` + `entradas`), e ganhou um par que prova que o perfil não tem forma de catálogo |
| 2 | A fixture de domínio, montada em diretório temporário, não enxergava o perfil de conformidade | `conformidade` entrou como symlink ao lado de `santana-authority`, nos dois executores. A fixture troca **apenas** o catálogo de domínio |
| 3 | O teste de caminho neutro comparava um caminho com `..` no meio, porque `juntar` não normaliza | Resolução por URL em vez de concatenação |

Duas observações que valem registro, porque poderiam ter virado divergência:

- **`{}` é *truthy* em JavaScript.** O defeito original da POC — o `or` falsy que
  transformava `{}` em `null` — não se reproduz em TS. A distinção que importa
  (chave ausente × chave presente com `{}`) continua explícita e continua sendo
  provada pelo V12-A.
- **`bruto: null` não pode ser elidido.** É a única exceção declarada à regra
  "sem `null` na forma canônica", e está comentada no código. Era o detalhe mais
  fácil de errar do porte inteiro.

## 12. Zero alteração nos vetores

**Nenhum vetor foi alterado para acomodar o TS.** Verificável no diff: os
arquivos de `conformidade/vetores/` aparecem como *rename* puro, sem alteração
de conteúdo.

O único arquivo novo em `conformidade/` é o perfil, que **não é vetor** — é
escopo técnico, e existe justamente para impedir duplicação entre as duas
implementações.

## 13. O que a Fase 3 não fez

- Não iniciou a Fase 4.
- Não executou NVIDIA nem Gemini.
- Não tocou Parlant runtime, n8n, W-API, Supabase ou produção.
- Não alterou o catálogo oficial, `MAP_MODALIDADE_TARIFARIA` nem
  `MAP_VIGENCIA_TABELA_TARIFARIA`.
- Não inferiu `OSSUARIO -> EXUMACAO_DE_OSSUARIO`. O `V10-C` prova que a
  equivalência continua não sendo feita, e um teste estrutural proíbe o literal
  da modalidade em todo o código do Gateway.
- Não substituiu a referência Python: ela continua sendo referência de
  conformidade, nunca runtime de produção.

## 14. Pendências

| Pendência | Natureza |
| --- | --- |
| `static` no GitHub Actions | `BLOCKED_BY_ACTIONS_QUOTA` até 01/09/2026; merge exige o PASS real |
| Tag `poc/exumacao-fase4a` → `714f0fe` | externa; HTTP 403 no push; não bloqueante |
| `main` tecnicamente desprotegida | política operacional de 8 regras em vigor |
| `MAP_MODALIDADE_TARIFARIA` | decisão humana; a jornada de preço não termina em valor sem ela |
| `MAP_VIGENCIA_TABELA_TARIFARIA` | confirmação humana de `07_01_2026` |
| R2/R3/R4 instrumentados | dependem de execução autorizada com modelo |
| Léxico de apresentação (R5) e `pergunta_pendente` (R6) | camada de atendimento, ainda não portada |
