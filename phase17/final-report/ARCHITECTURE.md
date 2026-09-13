# Arquitetura implementada

## Fluxo isolado

1. **Entrada validada** — contrato `MotorV2LabInput` aceita mensagens sintéticas, fatos já conhecidos, chaves que não
   devem ser perguntadas, trilhas, lacunas administrativas e relógio fixo. Campos de resposta esperada, assertions ou
   labels do Gold são recusados.
2. **Compreensão multilabel** — `UnderstandingProvider` produz jornadas, subintenções, estados transversais, mudança de
   intenção, complexidade, risco/confiança e turnos de evidência.
3. **Trust boundary** — `GuardedUnderstandingProvider` rejeita versão errada, campos extras, tipos inválidos e labels
   fora dos limites antes da policy.
4. **Trilhas independentes** — cada assunto possui `track_id`, status, subintenções e data de atualização próprios.
5. **Fatos tipados e versionados** — fatos registram tipo, fonte, versão, confiança, status temporal e supersessão;
   correções não sobrescrevem o histórico.
6. **Policy/Risk Engine determinístico** — avalia risco, complexidade, lacunas administrativas e trilhas; bloqueia
   claims não verificados; decide preservação, prioridade, handoff, confirmação explícita e receipts.
7. **Registro de policy atual** — somente regras `current`, confirmadas pela Administração, versionadas e válidas no
   instante de avaliação podem ser recuperadas. O LAB injeta lista vazia, portanto corpus histórico nunca vira regra
   atual.
8. **Action Gateway fechado por padrão** — somente tools allowlisted; idempotency key obrigatória; ações irreversíveis
   exigem confirmação explícita; executor externo precisa ser injetado e habilitado; receipts recebem hashes de payload,
   referência e integridade.
9. **Persistência e auditoria** — store isolado aplica revisão otimista, deduplicação de inbound, hash canônico de
   estado e eventos auditáveis.
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
- o Action Gateway foi testado com executor sintético injetado, não integrado a serviços reais;
- o provider benchmarkado é determinístico e não usa IA;
- o store é em memória e serve ao LAB, não substitui a persistência atual.
