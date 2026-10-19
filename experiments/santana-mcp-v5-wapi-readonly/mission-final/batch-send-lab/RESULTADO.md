# Resultado — MCP Santana, envio simplificado e lotes no LAB

**Implementação isolada concluída; instalação no plugin ativo e promoção para produção pendentes.**

O runner existente da VPS aprovou **73 testes** (40 Python, 26 de integração/regressão com o canal oficial e 7 Postgres isolados). A execução levou 32,8 segundos, com pico transitório de 897 MiB no processo filho mais pesado da suíte SQL. Nenhum serviço novo ou processo permanente foi deixado ativo.

Evidência: [GitHub Actions 39227852351](https://github.com/toomcruz/cemiterio-santana-5b3-test/actions/runs/39227852351), commit testado `7007677af71351164a34003439b34fbb3c27ab8f`; detalhes em `validation/runner-result.json`.

| Cenário | Resultado comprovado |
|---|---|
| Destinatário por final inequívoco | Preparação com prévia; final ambíguo bloqueado |
| Lotes fictícios de 2, 10 e 50 | Uma revisão por lote; 2, 10 e 50 operações distintas |
| Respostas personalizadas | Contexto/texto vinculado a cada conversa fictícia |
| Imagem e PDF | Bytes, nome, MIME e hash revisados e vinculados |
| Aprovação | Rota protegida testada por HTTP com sessões sintéticas; OAuth do modelo não aprova |
| Duplicação e concorrência | Ledger global v5, claim persistente, controles simultâneos e janela global |
| Falha e resultado desconhecido | Falha individual registrada; desconhecido pausa o lote; reconciliação não envia |
| Acompanhamento | Estado/auditoria por destinatário; nenhuma gravação no Painel real |

O intervalo mínimo de dois segundos foi validado com relógio controlado: não foram executados disparos reais de 50 contatos. Os aceites são simulações e não confirmam entrega.

## Limites concretos

- A prévia MCP e a tela única foram implementadas e testadas por protocolo/HTTP. O widget ainda não foi demonstrado dentro do ChatGPT real. Não há prova verificável disponível nesta conexão que permita tratar a confirmação comum do ChatGPT como a sessão humana independente exigida pelo backend. A alternativa implementada é uma única tela protegida para o lote integral.
- O serviço MCP LAB instalado está em diretório root. O runner confirmou `code_readable_by_runner=false` e `code_writable_by_runner=false`. Não foi usado Boss/Sana para contornar esse limite, nem foi solicitado patch root para um fluxo cuja integração de identidade real continua pendente.
- O verificador real das sessões HOMOLOG/PROD, o armazenamento privado do manifesto e sua autorização atômica ainda precisam ser conectados antes da instalação operacional. O candidato não habilita envio real por flags.
- A promoção precisa preservar o coordenador oficial e registrar cada filho no histórico oficial, conforme `DEPLOYMENT-SCOPE.md`, seguida de autorização específica. A permissão de leitura não autoriza escrita ou lotes. Nenhum envio real foi autorizado ou executado neste trabalho.

## Separação do OpenBot

**Nesta implementação:** nenhuma chamada a `enviar_mensagem_agente`, Boss, Sana ou à ponte multiagente. Execução local e runner do GitHub Actions. Somente os estados/PIDs públicos dos serviços foram consultados, sem ler configurações privadas ou mudar serviços. Antes/depois: mesmos PIDs e estados do MCP, túnel MCP, OpenBot, túnel Boss e Docker.

**Etapa anterior de memória/RESULT_MISSING:** houve instruções de diagnóstico de leitura ao Boss e um teste sintético direto com a Sana, usando `enviar_mensagem_agente` e consultas de retorno. O Boss encontrou uma execução concluída sem resposta assistant disponível; a Sana retornou `SANA_LAB_RETORNO_OK_20261018`, uma tentativa. Os artefatos preservam esse resultado, mas não a transcrição integral de cada instrução antiga. Ficaram os registros normais das mensagens/execuções e evidências; o instalador anterior abortou sem alterar código ativo. Essa etapa não foi reativada neste trabalho.

Produção, Sana, n8n, W-API, webhooks e Boss Bridge preservados. Zero mensagens reais, zero alterações de produção, zero concessões novas e zero ativações automáticas.
