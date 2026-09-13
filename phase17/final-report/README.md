# Fases 16–17 — Motor V2 isolado

Este pacote registra a implementação inicial e o benchmark isolado do Motor V2 contra as 20 fixtures imutáveis da
Fase 15.

## Veredito

**GATE HUMANO 1 — APTO PARA SHADOW MODE**

O veredito é estritamente o resultado dos critérios congelados na Fase 15. Ele autoriza somente a avaliação humana de
uma futura Fase 18. Não autoriza shadow, canário, produção, migração, resposta a munícipes ou efeitos externos.

## Limitação central

O benchmark usou o provider determinístico de LAB `lab-semantic-v1` (`uses_ai=false`) para manter isolamento e
reprodutibilidade. A fronteira de compreensão por IA foi implementada e validada por schema fechado, mas um provider de
IA controlado não foi exercitado nesta fase. Essa validação deve ser o primeiro gate técnico de uma eventual Fase 18 em
shadow sem efeitos.

## Evidência principal

- fonte: 20 fixtures `gold-fixture-v2.1.0`, hash agregado congelado;
- código final auditado: commit `679598404eb5aa24b9bba5af6fba6f72437fca1f`;
- evidência final: passe 6, com manifesto próprio e proveniência do HEAD;
- runtime atual: workflow oficial v1, estado/persistência/outbox em memória;
- Motor V2: três replays completos e idênticos;
- V2: 100% nas oito dimensões, 0 P0, 0 P1 e 0 hard guards;
- workflow atual: 4 P0 e 107 P1, sem hard guard do ambiente;
- regressão pareada: nenhuma regressão por caso ou dimensão;
- testes: 317/317 Deno no escopo domínio/benchmark, 25/25 no Authority Gateway e 9/9 Python/scorer.

O agregado é apenas secundário. O gate foi decidido pelas dimensões e guardas individuais.

## Conteúdo do pacote

- `docs/`: arquitetura, reuso, mudanças, testes, benchmark, falhas, rollback, privacidade e recomendação para o próximo
  gate;
- `source/`: snapshot do código novo e patch Git contra a base isolada;
- `benchmark/primary/`: comparação oficial compatível com a Fase 15;
- `benchmark/role-aware-diagnostic/`: diagnóstico adicional do adapter atual;
- `benchmark/final-pass-6/`: engine runs e comparação oficial do passe final;
- `audit-history/`: evidência selecionada dos passes superseded e correções, sem participar do veredito;
- `immutable-input/`: fixtures, schemas, gate e manifestos congelados da Fase 15;
- `VERDICT.txt`: veredito resumido;
- `MANIFEST.sha256`: integridade de todos os arquivos do pacote.

Nenhum artefato contém credenciais, PII, texto bruto de WhatsApp ou adaptador de produção.

O teste amplo de todo o repositório continua bloqueado por um erro de tipo preexistente em
`edge-functions/_shared/tests/official-runtime-store_test.ts:121`; o mesmo erro reproduz no commit-base e não pertence
ao diff das Fases 16–17.
