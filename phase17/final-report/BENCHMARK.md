# Benchmark final — workflow atual completo × Motor V2

## Protocolo

- 20 fixtures imutáveis da Fase 15;
- mesma versão de schema e mesmos hashes;
- workflow atual executado pelo caminho oficial v1 completo e seguro em memória;
- Motor V2 executado três vezes em runtimes independentes;
- sem rede, banco externo, transporte, credenciais ou produção;
- scorer comum, sem alterar o Gold;
- agregado secundário, nunca usado para esconder falha dimensional.

## Métricas por dimensão

| Dimensão          |   Atual | Motor V2 |        Delta |
| ----------------- | ------: | -------: | -----------: |
| Compreensão       |  43,33% |  100,00% |  +56,67 p.p. |
| Contexto          |  38,68% |  100,00% |  +61,32 p.p. |
| Multi-intenção    |   0,00% |  100,00% | +100,00 p.p. |
| Handoff           |  10,00% |  100,00% |  +90,00 p.p. |
| Segurança         |  96,67% |  100,00% |   +3,33 p.p. |
| Eficiência        | 100,00% |  100,00% |    0,00 p.p. |
| Receipts/ações    |  96,67% |  100,00% |   +3,33 p.p. |
| Conclusão correta | 100,00% |  100,00% |    0,00 p.p. |

## Falhas

- workflow atual: 4 P0, 107 P1, 0 P2 e 0 P3;
- Motor V2: 0 P0, 0 P1, 0 P2 e 0 P3;
- casos críticos: atual 20/20; V2 0/20;
- hard guards ambientais/privacidade: 0 em ambos;
- regressão pareada: nenhuma.

## Operação observada no LAB

| Métrica               |       Atual |    Motor V2 |
| --------------------- | ----------: | ----------: |
| Latência mediana/caso |   6,7578 ms |   1,0016 ms |
| Latência média/caso   |   8,7646 ms |   1,2299 ms |
| Latência máxima/caso  |  26,5263 ms |   3,7857 ms |
| Retries               |           0 |           0 |
| Chamadas de rede      |           0 |           0 |
| Saída média do trace  | 2.048 bytes | 2.451 bytes |

Memória foi medida dentro de um único processo e sofre influência do garbage collector; é evidência observacional, não
comparação de capacidade.

## Reprodutibilidade

- três replays do V2;
- vetores críticos idênticos;
- scores exatos idênticos;
- traces exatos idênticos;
- variação dimensional máxima: 0,00 ponto.

## Custo

- tokens/model calls: 0;
- custo externo de inferência: 0;
- retries: 0.

Isso decorre do provider determinístico de LAB e não estima custo nem latência de um provider de IA real.

## Diagnóstico adicional

O modo `role-aware-v1`, que nunca submete mensagem de assistente como entrada de munícipe, produziu as mesmas métricas
dimensionais do baseline compatível. Ele é evidência diagnóstica; o comparativo oficial permanece `compat-v1`, alinhado
ao contrato da Fase 15.
