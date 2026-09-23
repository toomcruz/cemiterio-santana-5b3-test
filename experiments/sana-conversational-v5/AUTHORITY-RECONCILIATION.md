# Sana V5 — reconciliação de autoridade de Exumação

Status: **análise somente leitura; nenhuma fonte oficial alterada**.

## Achado principal

Hoje existem duas bases com pretensão de autoridade que não são equivalentes:

1. **Authority Gateway / `santana-authority/catalogo/exumacao.v1.json`**, consumido pelo runtime conversacional atual.
2. **Base Oficial no Supabase SANTANA** (`service_rules`, `service_documents`, `service_conditions`, `service_prices`, `service_messages`), criada anteriormente para o fluxo V5 legado.

A documentação da Base Oficial declara que Supabase deveria ser a fonte única e que o Gemini deveria receber apenas o recorte necessário. Entretanto, essa base continua em **shadow/test-only** e o runtime atual consulta o Authority Gateway.

## Comparação observada

### Documentos

O Authority Gateway declara o tipo de informação `DOCUMENTOS`, mas o catálogo de Exumação examinado não contém entradas documentais suficientes para responder a lista do caso.

No Supabase existem listas estruturadas para:
- Exumação em Quadra Geral;
- Exumação em Jazigo de Família;
- documentos obrigatórios;
- documentos condicionais por morte não natural, baixa renda, doação de órgãos, responsáveis distintos e linha familiar.

Consequência atual: o runtime pode retornar `NOT_AVAILABLE` para documentos embora existam dados em `service_documents`.

### Preços

As duas fontes usam modelos diferentes e não podem ser mescladas automaticamente.

Authority Gateway contém modalidades tarifárias como:
- exumação de ossuário;
- sepultura em cessão de terreno a prazo indeterminado;
- sepultura em cessão de gaveta unitária a prazo fixo.

Ele próprio marca como pendente o mapeamento entre essas modalidades e os conceitos Santana como Quadra Geral/Jazigo de Família e também registra dúvida de vigência da tabela.

A Base Oficial do Supabase possui códigos orientados ao fluxo operacional, incluindo valores para Quadra Geral, Jazigo de Família, opções de ossuário e corpo semi-intacto.

**Não há evidência suficiente para declarar que uma linha de uma base equivale a uma linha da outra apenas pelo nome.**

### Regras e condições

Há sobreposição real (prazos, horários, documentos condicionais, assinaturas), mas a forma de modelagem e a proveniência não são idênticas.

O audit log do Supabase mostra a carga como `implantacao_v5`; isso prova quando/como as linhas foram inseridas, mas não resolve sozinho qual fonte documental externa deve prevalecer diante de divergência.

## Decisão técnica da V5 experimental

Até uma decisão humana de conteúdo:

- não consultar as duas fontes e escolher silenciosamente a resposta mais conveniente;
- não promover `service_prices` ou `service_documents` automaticamente para o Authority Gateway;
- não inferir equivalência tarifária por palavras como “jazigo”, “quadra geral” ou “ossuário”;
- manter ausência/conflito explícitos;
- permitir que o laboratório teste condução conversacional sem transformar isso em aprovação de conteúdo.

## Gate necessário antes de produção

Produzir uma matriz por item:

| Informação | Authority Gateway | Supabase Base Oficial | Fonte primária comprovada | Decisão |
| --- | --- | --- | --- | --- |
| Documentos Quadra Geral | incompleto/indisponível | presente | a confirmar | BLOQUEADO |
| Documentos Jazigo Família | incompleto/indisponível | presente | a confirmar | BLOQUEADO |
| Preço de Exumação | modalidades tarifárias próprias | códigos operacionais próprios | tabela tarifária + mapeamento | BLOQUEADO |
| Prazo de análise | parcial | presente | a confirmar | BLOQUEADO |
| Horário | parcial | presente | a confirmar | BLOQUEADO |
| Assinatura/autorização | presente em ambos em formas diferentes | presente | regra administrativa | RECONCILIAR |

Somente itens com fonte primária, vigência e mapeamento aprovados podem virar conhecimento `AVAILABLE` para a redação V5.

## Implicação

A rigidez conversacional e a lacuna de conhecimento são problemas distintos:
- a V5 experimental trata a **condução**;
- esta reconciliação trata **o que a Sana pode afirmar como oficial**.

Não corrigir a segunda parte faria uma Sana mais natural continuar respondendo “não tenho informação oficial” em situações nas quais outra base contém dados ainda não reconciliados.
