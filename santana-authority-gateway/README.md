# Santana Authority Gateway — implementação definitiva (TS/Deno)

Porta única entre o atendimento e o conhecimento/estado do Cemitério Santana. Duas responsabilidades, e só essas:
**consultar** o catálogo oficial estruturado e **registrar fato** com segunda validação antes de qualquer escrita.

Tudo falha fechado. O que não pode ser determinado vira `NOT_AVAILABLE` com encaminhamento à Administração, nunca uma
resposta aproximada.

## O que este diretório não contém

|                      |                                                |
| -------------------- | ---------------------------------------------- |
| Catálogo oficial     | `santana-authority/catalogo/` — caminho neutro |
| Vetores e perfis     | `conformidade/` — contratos compartilhados     |
| Catálogos de domínio | `santana-conversation-domain/`                 |

O Gateway **não é dono** de nenhum desses. Ele lê os mesmos arquivos que a implementação de referência Python lê, e há
teste que falha se o catálogo oficial passar a viver dentro de uma implementação.

## Módulos

| Arquivo                            | Responsabilidade                                           |
| ---------------------------------- | ---------------------------------------------------------- |
| `caminhos.ts`                      | Resolução de caminhos; overrides usados só pelas fixtures  |
| `canonico.ts`                      | Ordenação por code point, JSON canônico, datas civis       |
| `catalogo/erros.ts`                | `ErroDeCatalogo` e os quatro códigos estruturados          |
| `catalogo/carregar.ts`             | Carga, filtro de fonte não aprovada, `release_id`          |
| `dominio/catalogo.ts`              | `FactSpec` e escopo vindo do perfil compartilhado          |
| `resposta.ts`                      | `RespostaAutoritativa`, códigos, forma canônica            |
| `consulta.ts`                      | Três baldes, especificidade, desempate, `opcoes_por_campo` |
| `argumentos.ts`                    | Contrato canônico de argumentos (R1/V12)                   |
| `caso.ts`                          | Estado do caso — única superfície mutável                  |
| `escrita.ts`                       | `registrarFato` e as barreiras de escrita                  |
| `gateway.ts`                       | Porta única                                                |
| `conformidade/executar_vetores.ts` | Executor dos vetores V1-V12                                |

## Decisões que o porte tornou explícitas

**Datas civis são texto.** `Date` não entra no Gateway: ele é baseado em UTC e deslocaria uma fronteira de vigência
conforme o fuso do processo. ISO-8601 ordena corretamente por comparação lexicográfica. Há teste proibindo `new Date`.

**Ordenação é por code point.** Nunca `localeCompare` (difere em acentuação) e nunca o `sort()` padrão (ordena por code
unit UTF-16, que diverge do code point fora do BMP). É o que o `sorted()` do Python faz, e é com ele que precisamos
concordar.

**Chaves são ordenadas explicitamente** na canonização. A ordem de inserção de objeto JS vale para chave não-inteira,
mas reordenaria uma chave numérica em silêncio.

**`bruto` é a única exceção à regra "sem `null`".** Ele preserva literalmente o valor do evento para auditoria,
inclusive quando é `null` — V12-B, V12-C e V12-G esperam exatamente isso.

**Dinheiro é string.** Sem parse, sem formatação, sem aritmética. Há teste proibindo `parseFloat`, `parseInt`, `toFixed`
e `Number(`.

## Como rodar

```
deno run  --allow-env --allow-read --allow-write --allow-sys \
          santana-authority-gateway/conformidade/executar_vetores.ts
deno test --allow-env --allow-read --allow-write --allow-sys \
          santana-authority-gateway/tests
```

Sem rede, sem dependência externa, sem chave. É o que a CI executa.
