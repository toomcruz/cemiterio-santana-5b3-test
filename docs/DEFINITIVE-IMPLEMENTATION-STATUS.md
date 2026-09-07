# Implantação definitiva — evidência e critérios de corte

## Responsabilidade

`cemiterio-santana-5b3-test` é o proprietário do motor, interpretação, contratos,
persistência e integrações do backend. O repositório do painel deve conservar
somente interface e autenticação do operador, consumindo a API oficial.
Não há autorização arquitetural para fallback ao motor antigo.

## Conferência de 2026-09-07

- Base local de trabalho: `e0f0c71`, branch separada das alterações locais anteriores.
- Laboratório existente: `SANTANA-VNEXT-LAB`, migrações `0001–0020` presentes,
  29 estados conversacionais com transições e nenhuma Edge Function publicada.
- Rota publicada do painel ainda importa `lib/santana-intent` e chama
  `support-n8n-gateway`, `support-conversation-state` e `support-flow-context`.
  Logo, a substituição definitiva **não ocorreu**.
- Nenhuma conversa real, chave, conexão WhatsApp ou configuração produtiva foi
  alterada nesta etapa.

## Implementado nesta etapa

- `runtime/turn.ts` coordena interpretação, validação e reducer oficial. A
  interpretação também ocorre com objetivo/pergunta em andamento.
- O contexto inclui fatos do caso/objetivo em foco, sem fatos de outro caso.
- O prompt informa `message_id`, evidência literal e regras de continuidade.
- O provider Gemini fica em `integrations/` na base oficial, com chave somente em header,
  orçamento de saída e rejeição de respostas truncadas/bloqueadas. Não foi
  executado com uma chave real nesta etapa.
- Relato de reclamação é atribuído ao overlay correto; declaração do usuário
  não é constatação administrativa nem solicitação formal.
- Respostas de um caso não preenchem pendências de outro.
- Evidência do interpretador determinístico preserva texto original, inclusive
  acentos; mensagens de esclarecimento não exibem códigos internos.

`planTurn` produz uma **proposta**, não efetua persistência ou envio. Esta
separação não representa outro motor: toda decisão continua no reducer oficial.
O módulo ainda não está conectado ao painel nem liberado para produção.

## Gates ainda abertos — impedem declarar implantação concluída

1. Adaptar a leitura `conv_get_state` ao estado completo atual do reducer,
   incluindo identidade estável e objetos aditivos de processo. O mapa de IDs
   numéricos dos testes não deve ser usado sem isolamento em produção.
2. Implementar transação de ingestão, deduplicação, comparação de versão e modo
   humano, gravação do estado e outbox; testar disputa de mensagens/tomada humana
   e retomada após falha. Nenhum rascunho pode sair antes do commit.
3. Conectar o provider com configuração de servidor e fronteira de rede
   restrita; comprovar chamadas reais, quota, timeout e segurança adversarial.
4. Completar os fluxos de triagem e alternativas quando a pessoa não conhece
   um dado. Os testes novos provam preservação de contexto, não toda a conversa
   de titularidade/jazigo da captura de tela.
5. Integrar conhecimento autoritativo, documentos e solicitação com confirmação.
   O catálogo autoritativo contém pendências explícitas de modalidade/vigência
   tarifária; não preencher com inferência ou fatos do legado não aprovados.
6. Implantar API oficial no laboratório e executar o mesmo backend pelo
   simulador: webhook → estado → painel → outbox → simulador, inclusive anexos.
7. Migrar preservando históricos e protocolos, adaptar o painel e verificar
   permissões. Somente depois retirar chamadas legadas e realizar o corte.

Testes reais permanecem restritos ao único número autorizado pelo usuário.
Nenhuma liberação automática para os demais números. Em falha de corte,
preservar ingestão/atendimento humano e pausar o robô; não reativar motor legado.
