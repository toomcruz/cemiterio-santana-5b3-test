# Revisão única Santana — candidato isolado

O operador abre uma única tela do Painel, confere cada destinatário, texto e anexo, e usa **Aprovar e enviar**. O mesmo pedido HTTP registra a aprovação e solicita uma única tentativa pelo emissor nativo. O ChatGPT apenas prepara e consulta o recibo. Várias respostas podem ficar abertas, cada uma com sua própria operação e aprovação.

Este diretório contém uma extensão do sistema existente, não outro MCP, serviço ou emissor. O delta foi implantado após a aprovação do operador; confira [DEPLOYMENT-RESULT.md](DEPLOYMENT-RESULT.md). Nenhuma mensagem real foi enviada neste trabalho.

## Vínculos preservados

- A preparação recupera as 20 mensagens mais recentes pelo contexto administrativo existente. Sua revisão e watermark devem coincidir com a preparação. As indicações de paginação/truncamento permanecem no resultado; isso não afirma leitura do histórico completo.
- O OAuth existente identifica o proprietário da preparação e permite consultar seu recibo. **Não é identidade de operador PROD nem prova de aprovação.** A verificação de propriedade continua pela integração federada já utilizada pelo MCP. Não há token humano HOMOLOG, `postMessage`, login HOMOLOG ou token PROD enviado ao HOMOLOG.
- A aprovação usa somente a sessão individual PROD validada no servidor por `getUser`, emissor/audiência do JWT, associação administrativa ativa e sessão não revogada. O singleton Supabase e sua configuração são os mesmos do Painel. Uma sessão expirada abre o login na própria tela, com uma tentativa por ação do operador.
- O número nativo exato é fixado no servidor; a aprovação tem hash canônico de `{payload, recipient_e164}`. A tela protegida mostra o número completo, enquanto a consulta OAuth conserva o telefone mascarado. Destinatário, texto, anexos, conversa, revisão, watermark e UUID ficam vinculados à operação.
- Um desafio aleatório de 32 bytes, guardado somente como SHA-256 no banco, vincula a prévia à sessão PROD por até dez minutos. O rascunho dura até trinta minutos, limitado pela concessão existente. Não há desafio/token de sessão em URL, log ou tabela de rascunhos.
- A transação chama `sana_mcp_coordinated_send` existente. O emissor `sendManualWhatsApp`, `sana_control_transition`, `sana_manual_whatsapp`, os bloqueios e o armazenamento nativo de anexos são reutilizados sem alteração.
- Aprovação atômica retorna `fresh_approval` somente uma vez. Repetição do HTTP, recarga e resultado desconhecido só permitem consulta. Se a resposta se perder depois da aprovação e antes da execução, a operação permanece sem reenvio automático; não existe “retomar envio” oculto.
- `accepted_by_api=true` exige ACK do transporte oficial. Timeout/resultado ambíguo é `null`, não falha definitiva. `delivery_confirmed=true` exige histórico oficial com mesmo operador, operação, conversa e ID da mensagem entregue/lida. Sem essa evidência, permanece falso; nenhum webhook novo é criado.

## Validação reproduzível

`python3 mission-final/single-review-lab/run-validation.py`

O comando usa somente PostgreSQL/PGlite em memória, Auth simulado, transporte injetado no emissor real e testes DOM com React. Dependências isoladas: Node 24, PGlite 0.3.14, React/React DOM 19.2.6 (mesmo patch do Painel), jsdom 26.1.0, esbuild 0.25.12, TypeScript 5.9.3 e Supabase JS 2.110.8. Elas ficam no diretório temporário de dependências, sem serviço novo ou carga na VPS.

Resultados efetivos: [evidence/validation.json](evidence/validation.json). A prévia `preview-lab.html` é autocontida, com CSP `connect-src 'none'`: dois destinatários e recibos fictícios, sem login ou envio real.

Limites: a validação não substitui o build do projeto completo, a sessão real após implantação nem uma entrega WhatsApp. A inspeção visual no navegador foi impedida pela política que bloqueia URLs `file:`; não houve tentativa de contornar o bloqueio. Testes de interação e compilação da interface passaram. As transações concorrentes foram exercitadas pelo HTTP de teste e PGlite; não se afirma um teste de carga em PostgreSQL de produção.

## Implantação

Consulte [DEPLOYMENT-SCOPE.md](DEPLOYMENT-SCOPE.md). A aprovação de implantação não autoriza nenhuma mensagem. O fluxo antigo permanece disponível para operações antigas; falhas de rede/permissão no fluxo novo não ativam fallback de envio.
