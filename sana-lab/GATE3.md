# Gate 3 — n8n LAB manual, 24/09/2026

Branch `sana-lab-exumacao-f0-f2`, base `628fe74b3d0e2463146c1bfecaf89225ff473061`. O módulo canônico permanece `sana-lab/engine.ts`; o gateway oficial existente é consultado por ele. Não há implementação de regras de Exumação em Code nodes.

## n8n

- Workflow `m6y2AD8Vx1QZaJiE`, **SANA LAB — Exumação — Gate 3 manual (bloqueado)**, projeto pessoal WELLINGTON CRUZ, ativo: **não**, publicado: **não**, versão observada `10c5389a-8833-4946-b916-57248f508579`.
- Nós: `LAB — Início manual` → `LAB — Entrada sintética` → `LAB — Contrato e bloqueio seguro`.
- Execução manual real `10163`: status do executor `success`, saída `gate=BLOCKED`, `reason=CANONICAL_DENO_RUNTIME_NOT_CONNECTED`, contrato `sana-lab/1`, família `EXUMACAO`, objetivo `INICIAR_SERVICO`. `success` apenas indica que o adaptador terminou.
- A tentativa de validar `n8n-nodes-base.executeCommand` no Workflow SDK retornou `Unrecognized node type`; a validação individual de parâmetros passou, mas o SDK não permitiu criar a ponte. Code node não importa o projeto Deno e não dispõe de rede. Não houve tentativa de instalar runtime no host n8n ou de copiar regras para o nó.
- O workflow não contém webhook, credencial, nó HTTP, trigger recorrente ou envio. O campo `external_effects` na saída documenta o desenho; chamadas zero são corroboradas pela estrutura dos nós, não por telemetria de uma operação externa.

## Testes locais, fonte canônica

`adapter.ts` adapta a triagem legada com IDs explícitos. `tests/gate3_test.ts` executa A–F no mesmo `MemoryStore` e o teste anterior cobre persistência `FileStore`, revisão e outras exceções. Comando:

```sh
deno test --allow-read --allow-write --allow-env=SANTANA_CATALOGO_OFICIAL,SANTANA_PERFIL_EXUMACAO,SANTANA_REPO_ROOT sana-lab/tests
```

Resultado: **7/7 PASS**. Entradas sintéticas, interpretação simulada. Não são execuções da vertical no n8n.

| Cenário | Estado anterior | Decisão local observada | Novo estado e saída |
|---|---|---|---|
| A “Quero exumar meu pai” | novo caso `case-a` | `SIMULATED_OPERATION` | EXUMACAO, rascunho LAB relido, 1 operação; nenhuma abertura real |
| B “Quero colocar no ossuário” | mesmo `case-a`, rascunho LAB | `ANSWER` | `destination=OSSUARIO` declarado; 1 operação, fila sem demanda irmã |
| C “Quanto fica?” | mesmo caso e destino | `ASK`, preço `CONDITIONAL` | EXUMACAO preservada; sem valor inventado |
| D “Na verdade quero levar para outro cemitério” | destino OSSUARIO | `ASK`, traslado `UNKNOWN` | destino `OUTRO_CEMITERIO`, histórico preserva OSSUARIO; mesmo caso, 1 operação |
| E “Quanto fica?” em `case-b` | caso novo | `ASK` | sem destino ou rascunho herdado |
| F “Enviei um documento” | `case-a` após D | `ASK`, documentos `UNKNOWN` | `synthetic-file-1=RECEIVED_UNVERIFIED`; replay mesmo ID `DUPLICATE`, revisão não avança |

## Autoridade e lacunas

- `CONFIRMED`: declaração do munícipe sobre destino **somente como declaração**; rascunho local confirmado por releitura, nunca protocolo oficial.
- `CONDITIONAL`: preço depende da modalidade tarifária. O destino dos restos não determina a modalidade da sepultura.
- `UNKNOWN`: viabilidade do destino, condições de traslado, lista documental aplicável, validade de documento recebido. O motor continua perguntando quando pode fazê-lo com segurança; `UNKNOWN` não gera transferência automática.
- `HUMAN_DECISION_REQUIRED`: conflito de autorização declarado, quando ocorrer. A equipe deve decidir; a exceção é transversal.
- Ainda faltam autoridade/vigência da tabela tarifária, mapeamento de modalidade, regras condicionais, comprovante de documento validado, vínculo com armazenamento LAB n8n, executor do código Deno, operação administrativa e confirmação de encaminhamento real.

**GATE = BLOCKED.** Existe execução real no executor n8n do adaptador, mas não do módulo Exumação. O próximo passo seguro é disponibilizar uma ponte executável e isolada ao mesmo artefato `engine.ts` e ao catálogo versionado, com armazenamento LAB e sem caminho de envio, e repetir A–F no executor. Não iniciar Recadastro nem Gemini pago.
