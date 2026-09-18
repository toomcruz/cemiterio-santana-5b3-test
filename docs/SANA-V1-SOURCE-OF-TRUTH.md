# Sana V1 — fonte de verdade e corte de integração

Estado: **LAB / somente leitura contra produção**  
Data da verificação: 2026-09-18  
Escopo: B8/B1. Este documento não autoriza merge, deploy ou migration.

## Matriz de proveniência

| Componente | Repositório / recurso | Branch / referência | Commit ou versão observada | Publicado hoje | Candidato V47 / corte |
|---|---|---|---|---|---|
| Regras de negócio, reducer, catálogo e contratos | `toomcruz/cemiterio-santana-5b3-test` | `main` | `5fcba023a4fc461d91e0412fa041ed0669171680` | Fonte oficial no Git; publicação não presumida | Base do branch LAB `sana-v1-v47-integration-lab` |
| Edge source oficial `support-runtime-inbound` | `toomcruz/cemiterio-santana-5b3-test` | `main` | `5fcba023a4fc461d91e0412fa041ed0669171680` | Não demonstrado como o source do bundle ativo | Deve ser construído a partir desta fonte, após reconciliação |
| Migrations e RPCs oficiais | `toomcruz/cemiterio-santana-5b3-test` | `main` | `5fcba023a4fc461d91e0412fa041ed0669171680` | SANTANA contém migrations equivalentes até `20260915220113` | Adição somente após revisão LAB da migration proposta |
| Painel, rotas legadas e integração operacional | `toomcruz/atendimento-cemiterio-santana` | `main` | `436d3b8` (worktree local) | Publicação exata não verificada neste corte | Adapter de integração; não recebe cópia cega do domínio |
| Shadow/lifecycle operacional | `toomcruz/atendimento-cemiterio-santana` | `lifecycle-shadow` | `4f6c9e1` (worktree local) | Não é a fonte do domínio oficial | Apenas referência de compatibilidade, não corte |
| Candidata histórica V47 | worktree derivado de `atendimento-cemiterio-santana` | `sana-v1-release-candidate` | `1301508` (`073d6c5` baseline) | Não é runtime publicado rastreável | Evidência histórica; não é fonte para copiar |
| Edge ativo no Supabase SANTANA | projeto `zwbiqywqpllxfdofxtkz`, função `support-runtime-inbound` | recurso remoto | versão **56**, `ezbr_sha256=a44468f…`; body SHA observado `275d97e…` | **Ativo** | Não há commit Git oficial correlacionado; bloqueio B1 |

## Decisão de fonte

1. O domínio oficial (`reducer`, catálogo, contratos, Edge source e migrations) é o
   `cemiterio-santana-5b3-test@main` em `5fcba023…`.
2. O repositório `atendimento-cemiterio-santana` fornece o painel e os adapters
   operacionais. Ele não deve receber o worktree histórico inteiro da candidata.
3. O bundle remoto V56 é evidência de estado publicado, não evidência de
   proveniência. Seu source map referencia `bridge/sana-runtime-bridge.mjs` e não
   corresponde estruturalmente ao `support-runtime-inbound` de `5fcba023…`.
4. O único corte LAB atual é `sana-v1-v47-integration-lab` em cima de
   `5fcba023…`. O corte de implantação ainda não pode ser fixado porque a
   proveniência do V56 ativo e a integração com o adapter operacional não foram
   reconciliadas.

## B1/B8 — estado

- **B8 resolvido:** o repositório oficial está acessível, autenticado somente para
  leitura e verificado no commit acima.
- **B1 parcialmente resolvido:** a fonte correta e o corte LAB estão definidos,
  mas o runtime ativo V56 não tem linhagem Git comprovada. Não é seguro declarar
  que V47 substitui V56, nem preparar rollback, antes de reconciliar esse bundle
  com uma revisão do repositório oficial.

