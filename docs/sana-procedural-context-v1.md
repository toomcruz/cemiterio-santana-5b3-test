# Sana — contexto de procedimentos v1.0.1

## Fonte, alcance e autoridade

A fonte de contexto é `PROCEDIMENTOS_CEMITERIO_SANTANA_FLUXOGRAMA_E_RESUMOS.md`,
fornecida em 20/09/2026. O material descreve procedimentos e fluxos gerais;
não é autorização para transformar preços, prazos, documentos condicionais,
contatos ou regras históricas em orientação oficial atual.

O inventário conserva 16 procedimentos. Esta versão reconhece sua terminologia
e oferece explicações gerais, mas não implementa todas as jornadas operacionais
nem persiste um subtipo de procedimento em cada caso. Esses trabalhos são
separados da integração de contexto e ainda precisam de aprovação e testes.

## Integração no caminho realmente usado

- `procedure_knowledge.ts`: inventário da fonte, aliases conservadores e
  explicações de escopo `CONTEXT_ONLY`.
- `adapter/prompt.ts`: fornece somente associações de linguagem com goals
  existentes, não preços ou poderes administrativos.
- `interpreter/deterministic.ts`: acrescenta sugestões de roteamento sem
  substituir a coleta corrente ou converter posse de jazigo em destino de traslado.
- `official_information.ts`: integra a explicação também na via de perguntas
  informativas, que pode executar antes de `planTurn` e `draftReply`.
- `reply.ts`: consulta contexto somente depois das proteções de controle humano,
  encerramento, mídia e transições do atendimento.

Uma resposta oficial `AVAILABLE` continua tendo precedência. O contexto não muda
`NOT_AVAILABLE` para `AVAILABLE`, não substitui conflitos, contexto faltante ou
falha de carregamento de catálogo e não cria aprovação, agendamento ou validação.
A origem contextual é registrada em `contextual_source` no resultado da consulta;
isso, por si só, não comprova que toda a trilha já esteja persistida no banco.

## Correções incluídas nesta retomada

1. Perguntas de preço/procedimento não consomem pedidos de cancelamento ou
   encaminhamento humano. As regressões existentes são mantidas como testes.
2. Valores históricos não são publicados como resposta acompanhada apenas de
   ressalva. Preços, horários, contatos e prazos continuam pela via autoritativa.
3. Um local isolado, uma negação ou uma pergunta com mais de um procedimento não
   recebe um subtipo arbitrário por coincidência de palavras.
4. Traslado genérico/saída de Santana não usa automaticamente o procedimento
   específico de recebimento em Santana.
5. Um goal amplo de concessão não basta para escolher taxa, processo ou
   administração provisória. O mesmo cuidado vale para modalidades de ossuário.
6. `Temos jazigo da família` não produz o fato `transport_destination` na ausência
   de contexto ou intenção de transporte.
7. A via informativa passa a receber contexto explicativo, sem ignorar a fonte
   oficial e sem alterar os fatos ou o objetivo do caso.

## Conflito de fontes a resolver, não esconder

O resumo operacional classifica violação/furto/dano como ocorrência. O documento
legado `n8n-v4.15-servicos-comerciais-do-jazigo.md` distingue orçamento/reposição de
portão de ocorrências envolvendo urna, restos ou interior do jazigo. A integração
não escolhe silenciosamente uma dessas políticas pelo alias. A decisão de
precedência e vigência precisa ser registrada pelo responsável operacional.

Também não foi feita reconfirmação dos valores, telefones, prazos e condições do
material histórico. Dados já existentes em `service_rules`, `service_documents`,
`service_conditions`, `service_messages` e `service_prices` devem ser reconciliados
com a fonte aprovada, não recriados em uma base concorrente.

## Publicação: código testado não equivale a runtime publicado

A branch do PR #53 parte de `main` em
`5fcba023a4fc461d91e0412fa041ed0669171680`. O catálogo calculado nessa base é:

`cb91a91b2e3795ea8f08e54d448ccef6ad5600f7bdb8343125b3829de3e6d71a93`

O V4 observado no Supabase de produção usa outro catálogo:

`4eb8fb58a8c5531ad401fec93f87f6b22cf93b9ef1811d4e15274778ad4f82dd`

A linhagem versionada `cfd3a7f708fa89d52d38ec9a4e7bda6dfcb78bf7` calcula esse
segundo hash, mas não contém todas as alterações do invólucro publicado v5,
como a emissão do recibo de auditoria. Portanto, nenhuma dessas bases, sozinha,
deve substituir o bundle em execução.

Antes de publicar o contexto no canário, é obrigatório obter uma cópia
programaticamente verificável do bundle v5, conservar os módulos não alterados,
aplicar somente o delta do contexto, testar esse candidato e comprovar a
preservação do catálogo. Não migrar conversas para mascarar divergência de código.
Não declarar implantação concluída apenas por merge, build ou teste de unidade.

## Critérios de validação

Os testes exercitam o interpretador, respostas, via informativa, precedência
humana, fonte aprovada, conflitos e não-inferência de modalidade. Não há chamadas
Gemini, W-API, gravações no Supabase nem WhatsApp nos testes offline.

A validação completa do repositório continua sendo `shadow-static.yml`, sem
remoção de verificações. A validação do runtime publicado e o teste real privado
são etapas distintas e devem registrar seus próprios resultados.
