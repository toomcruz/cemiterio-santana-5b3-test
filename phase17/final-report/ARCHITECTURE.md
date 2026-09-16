# Arquitetura implementada

## Fluxo isolado

1. **Entrada validada** — contrato `MotorV2LabInput` aceita mensagens sintéticas, fatos já conhecidos, chaves que não
   devem ser perguntadas, trilhas, lacunas administrativas e relógio fixo. O contrato é fechado também nos objetos
   aninhados; campos de resposta esperada, assertions ou labels do Gold são recusados.
2. **Compreensão multilabel** — `UnderstandingProvider` produz jornadas, subintenções, estados transversais, mudança de
   intenção, complexidade, risco/confiança e turnos de evidência.
3. **Trust boundary** — `GuardedUnderstandingProvider` rejeita versão errada, campos extras, tipos inválidos, labels
   fora do catálogo e evidência apontando para turnos inexistentes antes da policy. Um overlay determinístico impede que
   um futuro provider controlado rebaixe sinais P0 formais presentes no texto.
4. **Trilhas independentes** — cada assunto possui `track_id`, status, subintenções e data de atualização próprios.
5. **Fatos tipados e versionados** — fatos registram tipo, fonte, versão, confiança, status temporal e supersessão;
   correções não sobrescrevem o histórico.
6. **Policy/Risk Engine determinístico** — avalia risco, complexidade, lacunas administrativas e trilhas; bloqueia
   claims não verificados; decide preservação, prioridade, handoff, confirmação explícita e receipts.
7. **Registro de policy atual** — somente regras `current`, confirmadas pela Administração, versionadas e válidas no
   instante de avaliação podem ser recuperadas. O LAB injeta lista vazia, portanto corpus histórico nunca vira regra
   atual.
8. **Action Gateway fechado por padrão** — somente tools allowlisted; cada tool possui um tipo exato de receipt;
   idempotency key é vinculada ao request completo; ações irreversíveis exigem confirmação explícita; executor externo
   precisa ser injetado e habilitado. Receipts vinculam payload, referência do executor e claims, recebem hash canônico
   e só são válidos quando coincidem com o ledger do próprio gateway. Requests são copiados antes do primeiro `await`,
   payloads aceitam somente objetos JSON simples e números finitos, chamadas concorrentes pela mesma chave são
   serializadas e resultados indeterminados permanecem bloqueados para reconciliação.
9. **Persistência e auditoria** — store isolado aplica revisão otimista, deduplicação de inbound vinculada ao hash do
   payload, isolamento por conversa, hash canônico de estado e eventos auditáveis.
10. **Resposta e trace** — renderer conservador não declara conclusão; benchmark trace separa intents, fatos
    reutilizados/perguntados, trilhas, handoff, claims, tools, receipts e fechamento.

## Autoridade

A compreensão pode propor interpretação e próxima pergunta. A policy e o Action Gateway mantêm fora da autoridade da IA:

- autorização ou decisão administrativa;
- aprovação documental;
- pagamento;
- agenda;
- mudança oficial de estado;
- ação irreversível;
- declaração de conclusão sem receipt correspondente.

## P0

O engine trata de modo fail-closed os sinais formais usados pelas fixtures, incluindo decisão administrativa, conflito
familiar, regra atual ausente ou conflitante, morte não natural, análise documental, corpo semi-intacto e baixa
confiança em contexto sensível. Risco P0 exige handoff P0.

## Limites desta implementação

- não existe adapter de produção;
- o runtime de LAB não executa tools externas;
- o Action Gateway foi testado com executor sintético injetado, inclusive caminhos positivos e adulterações; não foi
  integrado a serviços reais;
- o provider benchmarkado é determinístico e não usa IA;
- o store e o ledger de receipts são em memória e servem ao LAB; idempotência após reinício e persistência durável
  continuam fora desta implementação;
- `explicit_confirmation` ainda é um booleano confiado ao caller do LAB; uma integração futura precisa substituí-lo por
  evidência autenticada de confirmação;
- o contrato do executor exige idempotência durável, mas essa garantia só foi exercitada com executor sintético em
  memória.
