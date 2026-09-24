# SANA LAB — Exumação, Fases 0–2 (protótipo local)

**Base:** `toomcruz/cemiterio-santana-5b3-test` `5fcba023a4fc461d91e0412fa041ed0669171680`.
**Escopo:** execução local Deno, sem rede, Gemini, Supabase, n8n runtime ou WhatsApp. O canário `qxEGiuRNYEOT8smE` não é modificado. Nenhuma credencial entra no protótipo.

## Inventário direcionado

| Componente | Evidência/versionamento | Decisão | Lacuna |
|---|---|---|---|
| Workflow canário n8n | `qxEGiuRNYEOT8smE`, versão `96c348a9-b189-4335-8114-dfe186de7e39`, 7 nós; leitura 24/09 | Adaptar contrato da triagem; não editar | Não há persistência por caso nem Camada 2 conectada; resposta vazia encerra o ramo atual |
| Catálogo Exumação | `santana-authority/catalogo/exumacao.v1.json` na base acima | Reutilizar por gateway existente | Mapeamento de modalidade tarifária e vigência do arquivo tarifário pendentes |
| Gateway oficial | `santana-authority-gateway/gateway.ts`, `consulta.ts`, `resposta.ts` | Reutilizar consulta e proveniência | Não há conector autorizado para n8n LAB |
| Regras operacionais | repo principal `docs/regras-operacionais-n8n.md`, blob `3a912f4fa17df7bc5d22966e6dea418e0e9d1c6b` | Informação limitada sobre agendamento | Confirmar vigência e autoridade antes de uso real |
| Base de regras V5 | repo principal `docs/v5-base-oficial-regras-implantacao.md`, blob `0c07b713095010eddff8e7c8ad40462b85d066e6` | Candidato; não integrar | Documento diz workflow V5 gerado, não importado/ativado |
| Histórico `Entrega-Santana-Implementacoes-2026-09-09.md` | Não encontrado no caminho raiz do repo principal | Não usado | Localização e autoridade não verificadas |
| Jornadas legadas / V11 | Código e testes em repositórios, sem vínculo demonstrado ao workflow atual | Não assumir integração | Adaptadores e permissões pendentes |

## Contrato e execução

`contracts.ts` define `Input`, `CaseState`, `Result` (`sana-lab/1`), valida LAB/SIMULATOR, IDs, família, objetivo e proveniência de fato. `adaptLegacy` valida a saída legada antes da seleção determinística. IDs devem vir do chamador; o motor não os gera. A família `RECADASTRO` é reservada como irmã futura, mas retorna `UNSUPPORTED` nesta etapa; humano é exceção transversal, não família.

`engine.ts` consulta o gateway oficial para preço e documentos; informação de agendamento tem referência ao documento operacional. Registra referência declarada sem promovê-la a verificação. `FileStore` mantém estado somente em diretório local LAB, por `case_id`, com revisão, lock e leitura posterior. O bloqueio de duplicata cobre `inbound_message_id` no mesmo caso. O operador local tem de fornecer um diretório exclusivo; não aponta para o banco oficial. Uma operação de rascunho recebe ID `LAB-EXU-...`, é simulada e relida após escrita. Não cria solicitação real nem protocolo.

Rodar, da raiz do repositório, com Deno 2.1+:

```sh
deno test --allow-read --allow-write --allow-env=SANTANA_CATALOGO_OFICIAL,SANTANA_PERFIL_EXUMACAO,SANTANA_REPO_ROOT sana-lab/tests/vertical_test.ts
```

## Demonstração observada, exclusivamente simulada

| Entrada sintética | Saída observada | Consequência |
|---|---|---|
| “Quero exumar meu pai para colocar no ossuário” | `SIMULATED_OPERATION`, ID LAB e releitura positiva | Rascunho local; ossuário permanece destino, sem pedido irmão |
| “Quanto custa exumar para colocar no ossuário?” | `ASK`, sem valor monetário | Falta modalidade tarifária; destino não escolhe preço |
| “Enviei documento” + referência sintética | `ASK`, `RECEIVED_UNVERIFIED` | Arquivo não aprovado nem inspecionado |
| “Na verdade é minha mãe” | `ASK`, referência corrigida | Origem `CITIZEN` |
| “Como está meu pedido?” | `ANSWER` se houver rascunho do caso; `ASK` em outro caso | Sem vazamento entre casos |
| “Obrigado, encerrar conversa” | `RESOLVED_GRACE` | Conversa informativa concluída, sem afirmar serviço físico |
| “Quero falar com atendente” | `PEDIDO_HUMANO` | Exceção local com evidência; sem transferência real |
| “Existe disputa pela autorização” | `DECISAO_ADMINISTRATIVA` | Sem autorização automática |

**Teste:** 6/6 casos Deno locais aprovados em 24/09/2026; 0 chamadas Gemini; 0 operações de sistemas reais; 0 envios; consumo externo observado 0. Os testes usam interpretação simulada, não comprovam compreensão conversacional. Sem integração n8n, a demonstração em executor n8n e a persistência LAB remota estão **BLOCKED**. O gate de demonstração é **PARCIAL/BLOCKED** até revisão dos comportamentos e integração autorizada em LAB; não expandir Recadastro nem ativar Gemini.

**Lacunas:** validade dos horários operacionais; documentos condicionais por destino/assinante; tabela tarifária vigente e mapeamento; legitimidade; confirmação administrativa de data/autorizações; conexão a estado real; operação de registro autorizada; transferência humana confirmada; semântica de correções mais amplas e múltiplas demandas; conector n8n LAB. Não reaplicar migrações 22–26. A operação local `REGISTER_DRAFT_REQUEST` não equivale a pedido aberto.

**Próximo passo:** rever esta vertical e seu comportamento no gate; então integrar o mesmo contrato a um workflow n8n exclusivamente manual, sem nó de envio nem credencial W-API, com armazenamento LAB apropriado, antes de qualquer qualificação paga.
