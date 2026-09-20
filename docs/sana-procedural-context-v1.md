# Sana — contexto procedural do fluxograma Santana v1

## Origem

Esta camada foi criada a partir do arquivo operacional fornecido em 20/09/2026,
`PROCEDIMENTOS_CEMITERIO_SANTANA_FLUXOGRAMA_E_RESUMOS.md`, consolidado a partir
do fluxograma e da base de conhecimento do atendimento anterior em n8n.

O arquivo de origem deixa explícito que valores, prazos, horários, contatos e
regras correspondem ao período das fontes e devem ser conferidos na fonte
oficial vigente antes de serem tratados como atuais. Essa restrição é mantida
no runtime.

## Problema que esta camada corrige

O runtime V4 possuía estado, goals, facts e interpretação conversacional, mas o
LLM era — corretamente — limitado a interpretar linguagem. Ele recebia os
códigos do catálogo, porém não recebia o mapa operacional usado pelo atendimento
anterior. O resultado podia manter a conversa tecnicamente válida e, ainda
assim, soar sem contexto: sabia que o assunto era "concessão" ou "exumação", mas
não sabia distinguir Taxa de Concessão, Administração Provisória, remarcação,
óbito recente, acompanhamento de lápide e outros procedimentos do fluxograma.

## Arquitetura

A correção não transforma o Gemini em autoridade de regras.

1. `runtime/procedure_knowledge.ts` contém o mapa procedural determinístico.
2. O interpretador recebe somente aliases -> goal existente, para reconhecer a
   linguagem do fluxograma sem receber preços, prazos ou regras administrativas.
3. O fallback determinístico usa o mesmo mapa para que o entendimento não
   desapareça quando o provedor estiver indisponível.
4. A camada de resposta consulta o procedimento depois da interpretação e antes
   do fallback genérico. Respostas sobre documentos, etapas, valores, prazos e
   canais vêm do mapa, não de invenção do modelo.
5. Informações voláteis sempre carregam aviso de confirmação na fonte oficial.
6. Perguntas procedurais paralelas preservam a pergunta pendente do atendimento.
7. Não foram criados novos estados protegidos nem alteradas regras de
   autorização, agendamento, aprovação ou pagamento.

## Procedimentos representados

- Recadastro.
- Exumação em Quadra Geral.
- Exumação em Jazigo de Família.
- Renovação de Ossuário.
- Aquisição de Ossuário.
- Processo de Concessão.
- Taxa de Concessão.
- Administração Provisória.
- Cinzas em Jazigo.
- Translado para Santana.
- Óbito recente com jazigo.
- Serviços em jazigo, lápide e manutenção.
- Serviço funerário, velório e sepultamento.
- Remarcação de exumação.
- Violação, furto ou dano.
- Ouvidoria.

## Regras transversais preservadas

- Identificar o procedimento antes de definir documentos ou etapas.
- Considerar Quadra Geral, Jazigo de Família ou Ossuário quando aplicável.
- Documentos podem variar conforme o caso.
- Prazo de análise não equivale ao prazo total de conclusão.
- Pagamento não equivale a aprovação ou abertura do processo.
- Agendamento só é confirmado com confirmação efetiva.
- Valores históricos não substituem a tabela vigente.
- Sucessão, parentesco, titularidade e legitimidade podem exigir análise.
- Violação, furto e dano não são simples manutenção comercial.
- Procedimentos diferentes podem ter fluxos diferentes no mesmo jazigo.

## Escopo desta versão

Esta versão integra o conhecimento sem alterar o catálogo persistido de goals e
facts. Procedimentos que ainda não possuem goal próprio são roteados para o
goal existente mais seguro e conservador. Isso melhora imediatamente o contexto
do canário sem exigir migração do estado das conversas.

Uma futura versão do catálogo pode criar subtipos persistentes próprios para
óbito recente, administração provisória, taxa de concessão, remarcação e outros
procedimentos que mereçam acompanhamento operacional separado. Essa expansão
deve ser feita com migração e testes próprios, não por inferência do LLM.
