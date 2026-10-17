# Sana no OpenBot — base de trabalho EXCLUSIVA do laboratório

> **Estado:** material de conhecimento e cenários para homologação da Sana no OpenBot; NÃO integra o atendimento real, NÃO publica tarifa oficial, NÃO altera WhatsApp/W-API, Dify, Supabase, Vercel, webhook ou a Sana já instalada.

## Por que este pacote existe

O agente de testes respondeu sem valores às perguntas da Quadra Geral e de ossuário porque o catálogo oficial de exumação ainda tem mapeamentos de modalidade/vigência pendentes. Ao longo do projeto, o responsável informou valores e regras operacionais detalhadas que são úteis para testar o comportamento. O pacote preserva ambos os conjuntos **sem fingir que a divergência já foi resolvida**.

## Arquivos

- `regras-operacionais.lab.v1.json`: referências operacionais fornecidas pelo responsável, respostas por modalidade, documentos iniciais, limites de autorização e diferenças não resolvidas com a fonte oficial.
- `casos-multiturn.lab.v1.json`: 17 roteiros verificáveis; 14 podem ser exercitados pela comunicação de agentes; 3 exigem o runtime integrado e permanecem pendentes.
- `INSTRUCOES-PARA-SANA.md`: como a Sana deve consultar esta base **somente no LAB** e demonstrar uma resposta real.
- `validar_lab.py`: checagem estática sem rede. Não produz aprovação comportamental.

## Fontes e hierarquia

1. **Contrato técnico oficial e de produção:** `santana-authority/catalogo/exumacao.v1.json` e `santana-conversation-domain/*.v1.json`, com release_id/integridade preservados. Regras de autorização administrativa nunca podem ser substituídas por exemplos de conversa.
2. **Informações operacionais já fornecidas pelo responsável do projeto:** registradas neste LAB apenas como referência para respostas de teste. Preços, documentos, vigência e enquadramento só poderão ser promovidos após conciliação autorizada com a fonte tarifária vigente.
3. **Painel operacional atual:** `toomcruz/atendimento-cemiterio-santana`, em especial `docs/PRODUCTION-ARCHITECTURE.md`, `app/api/webhooks/wapi/route.ts`, `app/api/testing/wapi/route.ts`. O simulador atual NÃO executa a Sana do OpenBot.

### Divergências que permanecem abertas

| Assunto | Registro do atendimento / LAB | Catálogo técnico congelado | Situação |
| --- | --- | --- | --- |
| Exumação na Quadra Geral | R$ 350,00, informado pelo responsável | R$ 351,67 em **gaveta unitária a prazo fixo**; sem equivalência demonstrada com Quadra Geral | **Não converter automaticamente** |
| Aluguel de ossuário | R$ 386,65 / cinco anos, informado | Não há entrada do aluguel correspondente no catálogo de exumação | Validar fonte tarifária antes de produção |
| Compra de ossuário perpétuo | R$ 2.955,00, informado | Não há entrada equivalente no catálogo de exumação | Validar fonte tarifária antes de produção |
| Jazigo particular | Urna com exumação R$ 836,65, informado | 'Terreno a prazo indeterminado' R$ 586,04 não está mapeado como o mesmo serviço | Não equiparar rubricas |
| Semi-intacto | R$ 1.427,00, informado | Sem procedimento/tarifa oficialmente mapeados no catálogo congelado | LAB somente |
| Fonte 'Tabela_Politica_Tarifaria_07_01_2026' | Necessidade de conferir a vigência | Data interpretada do nome do arquivo, não confirmada | Pendente |
| 'Exumação de ossuário' | Não confundir com aluguel de ossuário **após** a exumação | Tarifa R$ 106,57 para exumação **feita no** ossuário | Conceitos diferentes |

## Critérios para testes

- A Sana responde valores do **LAB** quando a modalidade é conhecida, em linguagem curta, sem pedir documentos para esclarecer um preço e sem repetir 'consulte a Administração' a cada turno.
- As respostas de teste nunca se tornam prova de tarifa pública vigente. O agente não executa agendamentos, registros, autorização, verificação documental ou mensagens reais.
- A equipe humana revisa documentos. Para Quadra Geral, orientação inicial comunicada: certidão de óbito, RG/CPF e comprovante de residência do responsável; não transformar esse resumo em lista jurídica universal.
- A ordem de parentesco mencionada nas comunicações da Quadra Geral não substitui a regra oficial de assinatura em jazigo particular. Ausência de cônjuge deve ser interpretada conforme o caso, não mera indisponibilidade momentânea.
- Para um jazigo/ossuário cuja identificação o cidadão desconhece, registrar `indisponível` e perguntar **uma vez** pelo nome completo de algum(a) falecido(a) sepultado(a) no jazigo.
- Um teste é `PASS` somente quando a resposta **efetiva** do agente foi capturada e avaliada. Um roteiro ou HTTP 202 não é prova de execução.
- Os casos de duplicidade, isolamento de múltiplos contatos e pausa humana devem aguardar integração/runtime de testes apropriado, sem experimentar em produção.

## O que NÃO fazer

- Não editar o catálogo congelado, seus SHA/release_id, nem tabelas `service_*` de produção.
- Não ligar a Sana do OpenBot ao webhook da W-API nem deixar OpenBot e runtime atual responderem ao mesmo número.
- Não publicar/ativar integrações ou executar no WhatsApp real.
- Não criar uma segunda fonte oficial paralela: este é um pacote transitório de LAB para conciliação.

## Próxima ação prática

Solicitar à Sana, na seção **ATENDIMENTO** do OpenBot, que leia **este ramo GitHub e estes arquivos** como insumos de laboratório; verificar leitura do ramo antes de alterar as próprias instruções. Em seguida, o agente 'Munícipe de Teste' faz o diálogo de `S01` e envia a transcrição literal. Nenhuma alteração na produção é necessária para isso.
