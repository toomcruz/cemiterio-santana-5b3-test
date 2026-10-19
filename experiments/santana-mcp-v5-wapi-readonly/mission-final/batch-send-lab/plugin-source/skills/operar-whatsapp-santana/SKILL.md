---
name: operar-whatsapp-santana
description: Use para consultar ou preparar mensagens pelo plugin WhatsApp Santana MCP — LAB, validar sua fonte ativa e respeitar permissões e aprovação de envios.
---

# Operar o WhatsApp Santana MCP

O servidor desta integração é o WhatsApp Santana MCP v5 do usuário. Preserve a identidade, a conexão e o túnel desse plugin.

1. Antes de afirmar que está integrado ao WhatsApp, observe a fonte devolvida pela ferramenta:
   - source=fixture: dados fictícios locais; não é uma consulta ao WhatsApp.
   - source=synthetic_homolog: dados sintéticos do Supabase HOMOLOG; não são atendimentos reais.
   - source=sana_panel_fast_snapshot: leitura Sana; só afirmar acesso real quando o backend e a autorização individual estiverem comprovados.
   - source=w-api: verificar o endpoint e seu resultado; aceitação da API não é entrega de mensagem.
2. Use somente as ferramentas efetivamente anunciadas por este plugin. A ausência de uma ferramenta não autoriza escolher a ponte do Boss, MCPP, Sana, n8n ou outro App para substituí-la.
3. Se a leitura for negada, preserve a negação. Nunca peça service_role, tokens administrativos, senha ou JWT no chat, nem aceite credenciais de exemplo como credenciais reais.
4. A listagem de arquivos contém metadados. Não a apresente como conteúdo baixado. Se has_more for true, informe a incompletude e use o cursor correto para continuar.
5. Uma preparação de envio não é uma aprovação. Antes de qualquer envio real, mostre ao usuário um único destinatário verificado, o texto integral e os anexos exatos; obtenha sua aprovação específica e a aprovação independente exigida pelo servidor.
6. Não exponha ferramentas de escrita a clientes ou agentes sem suas permissões independentes. Não faça disparos em massa ou atendimento automático.
7. Respeite a pausa humana em todos os casos. Se o estado da pausa ou o coordenador de concorrência estiver indisponível, mantenha o envio bloqueado.
8. accepted_by_api significa aceitação na fila; delivery_status permanece desconhecido até uma confirmação autoritativa. outcome_unknown e sending não devem ser reenviados ou recriados para tentar novamente.
9. Envio real está bloqueado na consolidação v5 até autorização específica e coordenação com o canal oficial. A simulação é fictícia e deve ser identificada dessa forma.
10. Relate o resultado real da chamada. Não use o nome do plugin ou a presença de ferramentas como prova de autenticação OAuth ou de integração real.


11. Nas ferramentas de lote, source=isolated_synthetic_batch_lab identifica exclusivamente simulação. Não apresente aceite sintético como resposta da W-API real ou entrega no celular.
12. Não apresente nem abra approval_url em https://chatgpt.com/lab/revisar-lote: essa rota não existe. Use o componente de revisão realmente retornado por preparar_lote, preparar_envio_simplificado ou consultar_lote. Se a interface não estiver disponível, informe o bloqueio; não invente links nem apresente uma prévia textual como formulário de aprovação.
13. Uma notificação do componente de que o usuário revisou o lote é contexto do fluxo, não autorização por si só. Consulte o estado do lote e deixe o backend validar o recibo individual, o manifesto, a sessão e as permissões antes de cada operação. No LAB, use apenas executar_lote_simulado para operações fictícias aprovadas, respeitando o intervalo e consultando os resultados por destinatário.
14. Se a operação já foi revisada, consulte o resultado sem recriá-la. Só substitua uma preparação expirada depois de comprovar zero tentativas e ausência de aprovação/recibo. sending e outcome_unknown permanecem bloqueados contra repetição.
15. A aprovação exige prévia completa e carregada de todos os textos e anexos. PDF sem todas as páginas disponíveis, imagem inválida ou falha de integridade deve manter a aprovação bloqueada. Nunca repita login ou recuperação automaticamente.
