# Catalogo oficial estruturado — Exumacao

Este diretorio e a **unica** fonte de conhecimento que o Parlant consulta em
runtime, sempre atraves do Santana Authority Gateway. O Parlant nao le PDF, nao
le tabela solta, nao le Supabase e nao le arquivo arbitrario.

## Por que estruturado, e nao um texto

Preco de exumacao nao e um numero. Ele depende do servico, do tipo de sepultura
e do destino dos restos. Um catalogo com `preco_exumacao = X` responderia o
valor errado com toda a confianca do mundo — e o atendimento nao teria como
perceber. Por isso cada entrada declara **a que caso se aplica**, e o Gateway so
responde quando o caso em atendimento determina essa aplicabilidade.

## Estado atual: honesto, nao pronto

| Tipo de informacao | Fonte oficial aprovada | Resposta hoje |
|---|---|---|
| ASSINATURA_EXUMACAO | sim (`relations.v1.json`, decisao humana 6) | AVAILABLE |
| JAZIGO_DESTINO | sim (`facts.v1.json`, decisoes 1 e 2) | AVAILABLE |
| OSSUARIO | sim (`topics.v1.json`) | AVAILABLE |
| RESTOS_JA_EXUMADOS | sim (`relations.v1.json`, decisao 5) | AVAILABLE |
| **PRECO** | **nao** | NOT_AVAILABLE / encaminha |
| **DOCUMENTOS** | **nao** | NOT_AVAILABLE / encaminha |
| **PRAZO** | **nao** | NOT_AVAILABLE / encaminha |
| **PROCEDIMENTO_ADMINISTRATIVO** | **nao** | NOT_AVAILABLE / encaminha |
| **REGULARIDADE_DO_JAZIGO** | **nao** | NOT_AVAILABLE / encaminha |
| **SEMI_INTACTO** | **nao** | NOT_AVAILABLE / encaminha |
| **TRANSPORTE** | **nao** | NOT_AVAILABLE / encaminha |

Os sete de baixo **nao estao publicados porque nao existe fonte oficial
aprovada carregada aqui** — nao porque a POC decidiu esconder. A estrutura para
receber cada um ja esta declarada em `tipos_de_informacao`; falta o dado
aprovado. Enquanto faltar, o atendimento diz que a Administracao informa, e
isso e uma resposta correta, nao um placeholder.

**Isto e o que impede a Fase 3 de ser dada como concluida.** Para fechar,
alguem com autoridade precisa entregar os valores oficiais e aprovar as fontes.

## Como carregar uma fonte oficial

1. **Registre a fonte** em `fontes`, com `aprovada: true` apenas depois da
   aprovacao humana. Fonte com `aprovada: false` e ignorada em runtime — de
   proposito: rascunho nao atende municipe.

   ```json
   {
     "source_id": "SRC_TABELA_PRECOS_2026",
     "tipo": "DOCUMENTO_OFICIAL",
     "referencia": "Tabela de precos 2026, Administracao do Cemiterio Santana",
     "aprovada": true,
     "nota": "aprovada em <data> por <quem>"
   }
   ```

2. **Adicione as entradas**, uma por combinacao de aplicabilidade. Os campos de
   aplicabilidade validos de cada tipo estao em `tipos_de_informacao`.

   ```json
   {
     "entry_id": "EXU_PRECO_JAZIGO_OUTRO_CEMITERIO",
     "tipo_informacao": "PRECO",
     "aplicabilidade": {
       "servico": "EXUMACAO",
       "tipo_de_sepultura": "JAZIGO",
       "tipo_de_destino": "OUTRO_CEMITERIO"
     },
     "valor": { "valor": "R$ 000,00" },
     "vigencia": { "inicio": "2026-01-01", "fim": null },
     "source_id": "SRC_TABELA_PRECOS_2026"
   }
   ```

3. **Rode a suite**: `.venv/bin/python -m pytest tests/test_gateway.py -q`.

Nenhum passo envolve o Gemini. Nenhum PDF e passado ao modelo em runtime para
ele "descobrir" a regra.

## Regras que o Gateway aplica sozinho

* **Entrada mais especifica vence.** `{situacao_do_conjuge: VIVO}` ganha da
  entrada geral `{}`.
* **Criterio ausente do contexto nao casa.** O silencio nunca e tratado como
  confirmacao — se o caso nao diz o tipo de sepultura, o preco do JAZIGO nao e
  respondido; o motivo vira `APLICABILIDADE_INDETERMINADA`.
* **Duas fontes aprovadas discordando no mesmo caso viram `CONFLICT`**, nao
  escolha. Conflito encaminha para a Administracao.
* **Vigencia e respeitada.** Entrada fora do periodo nao responde.
* **Contexto vem de fato confirmado.** Alegacao pendente de verificacao pela
  Administracao nao seleciona resposta oficial.
* **Schema desconhecido falha fechado.** Um catalogo com `schema_version`
  diferente de `1.0` faz o runtime recusar carregar, em vez de adivinhar.

## release_id

O `release_id` e derivado do conteudo deste catalogo mais os catalogos de
dominio (`santana-conversation-domain/*.v1.json`). Mudou o conhecimento, mudou o
id — e todo log e toda resposta ficam correlacionaveis a uma versao exata.
