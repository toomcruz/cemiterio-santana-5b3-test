# Sana conversacional V5 — preview experimental

**Estado: implementação para revisão; não habilitada em produção.**

Base do núcleo: `toomcruz/cemiterio-santana-5b3-test@5fcba023a4fc461d91e0412fa041ed0669171680`.
Painel de produção observado em 2026-09-23: `toomcruz/atendimento-cemiterio-santana@7d6a33d51b76473a869688b8850a280fcaa1889c`.
A equivalência desse núcleo com todos os arquivos do bundle publicado NÃO é pressuposta; a comparação da função canário está registrada abaixo.
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
- `core.test.mjs`: 39 testes offline, com modelo e bridge controlados em memória.
- `official-adapter.test.ts`: 6 testes Deno com os módulos REAIS do repositório e modelo simulado.
- `multi-turn.test.ts`: 3 testes Deno de conversas com estado encadeado, reducer real, modelo simulado e conteúdo fictício sinalizado.
- Execução local desta etapa: 39 testes Node + 9 testes Deno = 48 aprovados; todos sem Gemini real.
- `MULTITURN-EVIDENCE.md`: entradas, estado anterior/posterior, decisão, rascunho e resultado dos critérios simulados.
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
deno check experiments/sana-conversational-v5/official-adapter.ts experiments/sana-conversational-v5/official-adapter.test.ts experiments/sana-conversational-v5/multi-turn.test.ts
deno test --allow-read experiments/sana-conversational-v5/official-adapter.test.ts experiments/sana-conversational-v5/multi-turn.test.ts
```

O teste não recebe `--allow-net` nem chaves. O adaptador Gemini é testado com `fetch` falso.
Nenhuma chamada Gemini real foi usada nesta etapa.

## Baseline e limite de comparação

Snapshot confirmado em 2026-09-23:

- Código V5 anterior às alterações desta etapa: branch `sana-conversational-v5`, commit `6d7ac874206a75d2f9c4fa01d7e9b3dc1be13b31`.
- Reducer/catálogo importado pela V5: base da branch, commit `5fcba023a4fc461d91e0412fa041ed0669171680`.
- Painel de produção observado: commit `7d6a33d51b76473a869688b8850a280fcaa1889c`.
- Função publicada observada: Supabase `support-runtime-canary-v4`, versão 19, release `sana-consolidation-20260921-v11-e2e`.

O bundle da função contém módulos de domínio que diferem dos mesmos caminhos na base do núcleo e não importa esta V5. Os testes desta branch medem somente a implementação V5 isolada sobre seu commit-base; **não medem melhoria em relação ao atendimento publicado**.

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

Os testes offline provam ordenação (fatos antes de consulta/redação), isolamento, limites, exclusão
 de outro caso/sessão, referência válida de fontes, deduplicação de parágrafos, cancelamento,
 rejeição estrutural e inexistência de persistência/transporte neste módulo. A suíte multi-turno encadeia
 o estado retornado pelo reducer real em memória e registra entrada, estado anterior/posterior,
 decisão e rascunho. Respostas do modelo são programadas; o conteúdo para testar composição está
 marcado como fictício e não altera o catálogo oficial.

**Eles NÃO provam a qualidade de interpretação/redação do Gemini real.** O planner e o writer
continuam simulados nos testes. A avaliação semântica de conversas inteiras com o modelo configurado
permanece pendente. `renderDraft` valida estrutura e referências, não implicação semântica:
texto com uma citação válida ainda pode estar incorreto. Por isso nenhum rascunho é publicável.

Não inferir qualidade, latência de Gemini ou custo real a partir dos testes simulados. Comparar uma
e duas chamadas, com qualidade, latência e custo observados, fica para etapa futura autorizada com
modelo real.

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
