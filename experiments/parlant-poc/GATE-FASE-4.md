# Gate da Fase 4 — primeira nova chamada Gemini real

Este documento existe para uma decisao sua: autorizar (ou nao) **uma unica**
conversa real, C1-preco, contra o Gemini. Nada nele foi executado com a chave.

Estado: **Fases 0, 1 e 2 concluidas. Fase 3 estruturalmente pronta, mas
incompleta por falta de dado oficial** — detalhe na secao 4, e e o ponto que
muda o que a C1 consegue provar.

---

## 1. O que mudou desde o ultimo FAIL

O blocker do run `32069767929` foi `<<__missing__>>` em quatro argumentos
obrigatorios. A inspecao runtime provou que o schema chegava intacto ao
ToolCaller — enum, descricao, tudo. O que restou foi a pergunta certa: **por que
pedir ao modelo um argumento que a Guideline ja determinou?**

| Antes | Agora |
|---|---|
| `consultar_base_autoritativa(assunto="PRECO")` | `consultar_preco_exumacao()` — **zero argumentos** |
| `registrar_fato(fato=<qualquer>, valor=<qualquer>)` | `registrar_finalidade_exumacao(finalidade: TRANSPORTE\|OSSUARIO\|CREMACAO\|OUTRA)` |
| `corrigir_fato(...)` — modelo escolhia registrar ou corrigir | nao existe: origem `USER_CORRECTION` deduzida do estado |
| 5 tools, 4 argumentos criticos escolhidos pelo modelo | 19 tools, **nenhum** argumento nao-linguistico |

As 7 tools de registro sao **geradas a partir de `facts.v1.json`** — nome, enum e
descricao saem do catalogo. Os tres fatos `authoritative_only` nao tem tool: nao
ha por onde nomea-los.

`<<__missing__>>` nao foi mitigado com prompt melhor. Ele deixou de ser um
resultado possivel nas consultas, porque nao ha argumento para faltar.

---

## 2. O que ja esta provado offline

| Prova | Como | Resultado |
|---|---|---|
| Consulta sem argumento vira chamada valida | `SingleToolBatch._evaluate_non_consequential_tool_calls` **real** do Parlant, com `args={}` | PASS, 10/10 tools |
| `<<__missing__>>` continua recusado onde ainda ha argumento | mesmo avaliador real | PASS, 7/7 fatos |
| Enum e descricao chegam ao prompt | `_add_tool_definitions_section` e bloco `TOOL TO EVALUATE`, renderizadores reais | PASS |
| Schema nao se perde do decorador ao engine | servidor Parlant de verdade + `ServiceRegistry.read_tool_service` | "tools cujo schema se perde: nenhuma" |
| Toda tool declarada chega ao engine | inventario lido do `ServiceRegistry` | 19/19 |
| `authoritative_only` inexpugnavel | schema + segunda validacao no Gateway | PASS |
| Autoridade sob conversa | bateria sintetica 100 conversas / 327 turnos | PASS, todos os gates 0 |
| Casamento de guidelines | 169 turnos avaliados | 169 acertos, 0 FN, 0 FP |
| Zero rede externa | `NetworkGuard` | 0 chamadas |
| Suite offline | pytest | 279 testes |

Custo em GitHub Actions destas provas: **zero minuto**. Tudo rodou local.

---

## 3. O que a C1 vai testar — e o que ela nao testa

A C1 e "quanto custa a exumação?". Com o contrato novo, a cadeia esperada e:

```
Gemini interpreta a frase
  -> G_PRECO casa
  -> consultar_preco_exumacao()          <- sem argumento nenhum
  -> Santana Authority Gateway
  -> status NOT_AVAILABLE + encaminha
  -> resposta: a Administracao informa o valor
```

Criterios da Fase 4, com o que cada um mede:

| Criterio | Quem responde |
|---|---|
| Gemini entende intencao | **so o Gemini** |
| G_PRECO casa | **so o Gemini** |
| Tool especializada chamada | **so o Gemini** (a escolha da tool e linguistica) |
| Argumento critico do LLM | ja resolvido: **nao ha argumento** |
| Authority Gateway consultado | ja provado offline; a C1 confirma no caminho real |
| Resposta final / `stage=completed` | **so o Gemini** |
| 404 / 429 / structured output error | **so o Gemini** |
| Preco inventado = 0 | ja provado offline; a C1 confirma sob linguagem real |
| Tool proibida = 0 | ja provado offline (conjunto permitido = conjunto declarado) |

**O que a C1 nao testa:** se o preco esta certo. Nao ha preco oficial carregado
(secao 4). A resposta correta hoje e "a Administracao informa" — e e isso que a
C1 valida.

---

## 4. Por que a Fase 3 nao esta concluida

O catalogo estruturado existe (`catalogo/exumacao.v1.json`) e o Gateway ja aplica
todas as regras: entrada mais especifica vence, criterio ausente do contexto nao
casa, fontes que discordam viram `CONFLICT`, vigencia e respeitada, fonte nao
aprovada nao entra em runtime.

O que falta e **dado**, nao codigo:

| Tipo | Fonte oficial aprovada | Resposta hoje |
|---|---|---|
| ASSINATURA_EXUMACAO, JAZIGO_DESTINO, OSSUARIO, RESTOS_JA_EXUMADOS | sim (decisoes humanas ja fechadas) | AVAILABLE, com `source_id` |
| **PRECO, DOCUMENTOS, PRAZO, PROCEDIMENTO_ADMINISTRATIVO, REGULARIDADE_DO_JAZIGO, SEMI_INTACTO, TRANSPORTE** | **nao** | NOT_AVAILABLE, encaminha |

Preco ficou modelado como contextual — servico, tipo de sepultura, destino,
vigencia, fonte — e nao como um numero. Enquanto nao houver tabela oficial
aprovada, o Gateway responde `SEM_FONTE_OFICIAL_CARREGADA`.

**Para fechar a Fase 3 preciso de voce:** a tabela de precos vigente, a lista
oficial de documentos, os prazos e o procedimento administrativo, com quem
aprovou e desde quando valem. O passo a passo de ingestao esta em
`catalogo/README.md`. Nao vou preencher nenhum desses valores por conta propria.

---

## 5. O que rodaria, se voce autorizar

- Workflow: `parlant-full-poc-gemini.yml`, por `workflow_dispatch`, com
  `conversas=C1-preco`.
- Modelo: `gemini-3.1-flash-lite`. Chave: o secret `PARLANT`, exposto so como
  `GEMINI_API_KEY`.
- **Uma** sessao, **um** turno. Pre-flight de uma chamada para detectar 404/429
  antes de subir a POC.
- Para em qualquer 404, 429 ou gate de autoridade diferente de zero.
- Nao avanca para C2-C5. Nao toca producao, Supabase, n8n, W-API, WhatsApp ou
  Vercel. Nao faz merge.

Classificacao do resultado, como combinado: A/B/C/D conforme onde a cadeia
quebrar — interpretacao, casamento de guideline, chamada de tool ou resposta
final.

---

## 6. Higiene de recursos

As tres workflows do laboratorio (`parlant-synthetic.yml`,
`parlant-poc-lab.yml`, `parlant-full-poc-gemini.yml`) rodam **somente** por
`workflow_dispatch`. Nenhum push dispara Actions.

Sandbox Nono (`nono/`) fica como ferramenta de desenvolvimento. Upgrade do
kernel WSL2 **nao** e pre-requisito de nada aqui: e so a condicao para rodar,
sob sandbox, os alvos que precisam de loopback.
