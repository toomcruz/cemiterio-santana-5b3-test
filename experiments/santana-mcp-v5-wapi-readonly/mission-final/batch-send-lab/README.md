# Envio simplificado e lotes — extensão isolada do MCP v5

Implementado em 19/10/2026, sem implantação no plugin ativo. Nenhuma mensagem real, credencial real ou alteração de produção integra este LAB.

## Funcionalidades executáveis

- `preparar_envio_simplificado`: resolve conversa, telefone autorizado ou final inequívoco. Um final ambíguo não é adivinhado.
- `preparar_lote`: de 1 a 50 conversas autorizadas, comunicado comum ou texto por conversa, imagem/PDF dentro dos limites existentes. A preparação não envia.
- `consultar_lote`: todas as operações e resultados, sem ocultar falhas ou desconhecidos.
- `executar_lote_simulado`: processa uma operação devida por chamada, com intervalo global persistente. Não exige aprovação por destinatário. Não cria worker nem serviço novo. A chamada seguinte respeita `next_at`; não há sono bloqueante ou retry automático.
- `reconciliar_lote`: consulta resultados autoritativos fictícios, sem chamar o transporte.

O módulo se monta na função `dispatch` e no `Handler` existentes, apenas em `DATA_SOURCE=fixture`. A leitura antiga permanece. O OpenBot não recebe essas ferramentas. Nenhum flag habilita transporte real nesta implementação.

## Revisão única

O componente MCP mostra a prévia dentro do cliente e abre uma única tela protegida para confirmar o lote integral. O backend vincula revisão ao operador, sessão, lista ordenada, conversas, telefones, conteúdo, nomes/MIME/hashes dos anexos e operações. A revisão não é uma ferramenta disponível ao modelo. O OAuth do modelo não pode atuar como sessão humana.

O LAB testa a rota por HTTP com sessões **sintéticas**, fornecidas por um verificador de testes. Não foi instalado um novo login nem autenticado um operador real nesse protótipo. A integração dos verificadores reais HOMOLOG/PROD com a revisão única é um gate de promoção; não basta ativar flags. Não afirmamos que um clique do ChatGPT fornece uma prova autenticada ao backend. A disponibilidade/renderização do widget na conexão real do ChatGPT ainda não foi comprovada.

## Reutilização e segurança

Reutiliza, sem alterar, o `AuditStore` v5 e seu fingerprint global. `sending`/`outcome_unknown` bloqueiam novas operações iguais mesmo após a janela normal. Aceites conhecidos usam a janela de deduplicação existente; o mesmo operation_id nunca executa novamente. Contatos fora do escopo, recusa de comunicação, mudança de contexto, revisão, telefone, sessão revogada, ausência de pausa ou concorrência bloqueiam a operação.

O coordenador SQLite emula a transação oficial exclusivamente com fixtures. Ele não é um lock que coordene produção. Os testes de contrato reutilizam `createSupervisedOfficialHandler` e `sendManualWhatsApp` com transporte injetado fictício. As regressões Postgres reutilizam o candidato de coordenação oficial já existente, em PGlite. Não há segundo emissor W-API.

Aceite simulado não é entrega. Falha definitiva fica registrada sem repetição automática. Resultado desconhecido pausa o lote inteiro; recuperação consulta o recibo e somente libera os demais itens quando há um resultado autoritativo. Uma interrupção após o claim nunca transforma o item em fila novamente.

Anexos comuns são armazenados uma vez no manifesto e devolvidos uma vez à tela de revisão, com conferência dos bytes. O ledger por operação e a auditoria permanecem separados por destinatário. Não se grava no Painel real nesta etapa.

## Executar

`python mission-final/batch-send-lab/run_validation.py`

O workflow existente `santana-mcp-lab-maintenance.yml`, ação `batch_validate`, executa também a regressão SQL na VPS. Instala somente uma dependência de teste fixada (`@electric-sql/pglite@0.3.14`) em diretório temporário, removido ao terminar. Não altera serviços. Testes Python bloqueiam conexões externas e permitem somente o listener efêmero local; testes Node bloqueiam rede e injetam o transporte simulado.

`validation/result.json` registra testes, demonstrações, memória máxima dos filhos e estados dos serviços antes/depois. `backup/manifest.json` registra os fontes preservados antes da implementação. O commit Git de origem é `2fba33131e4526271443344d18451e6a91214d53`.
