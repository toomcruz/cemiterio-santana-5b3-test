# Sana conversacional V5 — preview experimental

**Estado: implementação para revisão; não habilitada em produção.**

Base do núcleo: `toomcruz/cemiterio-santana-5b3-test@5fcba023a4fc461d91e0412fa041ed0669171680`.
Painel observado: `toomcruz/atendimento-cemiterio-santana@7d6a33d51b76473a869688b8850a280fcaa1889c`.
A equivalência desse núcleo com todos os arquivos do bundle canário V4/v11 publicado NÃO é pressuposta.
Não há alteração no painel, reducer, schema, migrações, Edge Functions, webhook, fila ou transporte.
Nenhum entrypoint produtivo importa este diretório.

## O que foi implementado

`runPreview` recebe uma cópia do estado, uma mensagem, histórico da sessão e dependências explícitas.
O primeiro estágio de modelo produz **interpretação canônica + condução conversacional** numa única chamada.
Quando há fatos/ações propostas, `official-adapter.ts` valida a interpretação usando o parser já existente
 e chama `planTurn`. Não existe um segundo reducer. Perguntas mistas consultam o conhecimento DEPOIS
 dessa atualização proposta, para não perder a resposta factual do munícipe.

Uma pausa puramente conversacional pode preservar o estado sem repetir a pergunta pendente.
Uma consulta puramente informativa pode consultar conhecimento sem abrir um pedido.
O segundo estágio redige o rascunho natural a partir do estado atualizado e das fontes disponíveis.
Não concatenamos `reply.ts` à resposta gerada: ele é apenas um fallback limitado para CONTINUE.
São no máximo duas chamadas do novo modelo, sem retries automáticos, com prazo global máximo de 12 segundos.

Todos os retornos possuem `draftOnly=true`, `requiresHumanReview=true`, `persisted=false`, `externalEffects=[]`.
Nenhuma transição proposta significa persistência, aprovação, encaminhamento, agendamento ou envio.
O módulo não recebe cliente Supabase, credenciais W-API, store de produção ou função de enqueue.

## Arquivos

- `core.ts`: contratos, contexto limitado e isolado por sessão/caso, plano validado, composição e telemetria.
- `official-adapter.ts`: reutiliza parser, reducer e Authority Gateway do núcleo oficial.
- `gemini.ts`: adaptador HTTP sem leitura de ambiente; credencial/modelo/fetch são injetados pelo chamador.
- `core.test.mjs`: 37 testes offline, com planner/writer e bridge controlados em memória.
- `official-adapter.test.ts`: 6 testes Deno com os módulos REAIS do repositório e modelo simulado.
- `tsconfig.json`: checagem local de core/provider; NÃO inclui o adaptador canônico.
- `.github/workflows/sana-v5-offline.yml`: checagem completa do adaptador e testes no checkout real, sem chaves.

## Rodar

Node 22.16 ou compatível com remoção de tipos:

```sh
node --experimental-strip-types --test experiments/sana-conversational-v5/core.test.mjs
```

Com TypeScript instalado:

```sh
tsc --project experiments/sana-conversational-v5/tsconfig.json
```

No checkout completo, com Deno 2.1.4 (versão já utilizada pelo CI do projeto):

```sh
deno check experiments/sana-conversational-v5/official-adapter.ts experiments/sana-conversational-v5/official-adapter.test.ts
deno test --allow-read experiments/sana-conversational-v5/official-adapter.test.ts
```

O teste não recebe `--allow-net` nem chaves. O adaptador Gemini é testado com `fetch` falso.
Nenhuma chamada Gemini real foi usada na validação local desta entrega.

## Conhecimento: não contornar ausência de autoridade

Este preview usa SOMENTE `officialInformationReply`/Authority Gateway. Não lê `service_rules`,
`service_documents` ou `service_prices` diretamente e não presume que uma flag histórica
`official_ready` prove vigência administrativa. Se a autoridade retornar NOT_AVAILABLE,
NEEDS_CONTEXT ou CONFLICT, a indisponibilidade permanece explícita.

O resultado da consulta tem ID e hash incluindo data de referência, conteúdo e retorno de autoridade.
Esses IDs/hashs vão para a telemetria, não mensagens, nomes, arquivos, URLs, credenciais ou raciocínio privado.
A reconciliação do catálogo embutido com as tabelas existentes continua sendo uma decisão de conteúdo,
não uma troca automática de fonte feita por esta implementação. A vertical inicial é Exumação.

## O que os testes provam — e o que NÃO provam

Os testes locais provam ordenação (fatos antes de consulta/redação), isolamento, limites, exclusão
 de outro caso/sessão, referência válida de fontes, deduplicação de parágrafos, cancelamento,
 rejeição estrutural e inexistência de persistência/transporte neste módulo.

**Eles NÃO provam a qualidade de interpretação/redação do Gemini real.** O planner e o writer
são simulados nos testes. A avaliação semântica de conversas inteiras com o modelo configurado
permanece pendente. `renderDraft` valida estrutura e referências, não implicação semântica:
texto com uma citação válida ainda pode estar incorreto. Por isso nenhum rascunho é publicável.

O adaptador reutiliza as restrições atuais do núcleo. Ele não corrige automaticamente todo erro
 de classificação dentro do reducer/bridge e não reescreve dados históricos. A reconciliação da
 versão implantada do canário com a base GitHub é necessária antes de integrar qualquer entrada real.

## Casos para avaliação com modelo real (sem envio)

As frases abaixo são exemplos de teste, não fatos nem orientações oficiais do cemitério.

| Caso | Conduta esperada a avaliar |
| --- | --- |
| “Volto já, pode aguardar.” | Pausa sem repetir a coleta nem prometer notificação futura. |
| “Vou jaja tá?” | Distinguir pausa de intenção de ir ao local; não presumir interpretação única. |
| “Não tinha companheira, e quais documentos eu levo?” | Preservar o fato no caso correto e responder a consulta sem repetir a pergunta anterior. |
| “Quero exumar meu pai e deixar no ossuário. Também queria saber os valores.” | Pergunta de preço não cria automaticamente assunto comercial independente. |
| “Ainda não quero abrir pedido. Como funciona?” | Explicar o que a fonte autoriza sem cadastrar pedido. |
| “Na verdade, a localização não é essa.” | Não inventar localização substituta. |
| “Agora é sobre meu tio.” | Não transferir os fatos do pai para outra pessoa. |
| “Já mandei o documento.” | Declaração do usuário não prova armazenamento nem validação. |
| Pedido de preço com fonte indisponível | Explicitar a lacuna, sem buscar valor em fonte não reconciliada. |
| Texto malicioso em mensagem/histórico | Não substituir política, fontes nem autoridade. |
| Humano ativo ou automação pausada | Nenhuma geração/envio automático. |
| Erro/timeout na IA | Sem retries infinitos, sem avançar produção, sem expor erros brutos. |

## Próximos gates (não executados automaticamente)

1. Verificar CI do adaptador real e revisar o PR; não mesclar só por testes unitários verdes.
2. Reconciliar bundle canário atual e base do núcleo; reaproveitar writer/planner já existentes quando aplicável.
3. Reconciliar e validar as fontes oficiais (inclusive documentos e tarifas), sem mudar valores por inferência.
4. Avaliar conversas multi-turno com Gemini real em ambiente isolado e amostra aprovada.
5. Somente com nova autorização: integração com simulador do painel, commit/outbox e eventual canário.

Referências técnicas utilizadas no adaptador HTTP:
https://ai.google.dev/api
https://ai.google.dev/gemini-api/docs/structured-output
