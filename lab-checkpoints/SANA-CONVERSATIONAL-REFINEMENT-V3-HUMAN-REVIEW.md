# SANA CONVERSATIONAL REFINEMENT V3 — HUMAN REVIEW

**Status:** PENDING_HUMAN_REVIEW
**Base V2 congelada:** bfc6c8335a6c72a401573ec2673f4d77a3dd9b3b
**Branch V3:** sana-conversational-refinement-v3
**Escopo:** 11 casos V2 REVISAR/REJEITADOS + 5 aprovados como amostra de não-regressão
**Gemini:** 0 chamadas
**Produção alterada:** não
**WhatsApp enviado:** 0

## sim-07 — pedido de orientação

**Decisão humana V2:** APROVADA
**Motivo/expectativa preservado:** Amostra de não-regressão; decisão humana V2 preservada.

### Turno 1
**Munícipe:** Não sei qual serviço preciso pedir.
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** Tudo bem. Você pode informar apenas o que souber. O que você precisa resolver hoje? Pode me contar com suas palavras. Se não tiver essa informação, pode me dizer isso e eu apresentarei a próxima opção segura.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Evento:** UNCERTAIN — evidência: nao sei
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** É sobre um jazigo da família.
**V2 — resposta anterior:** Entendi que o assunto é o jazigo da família. Você quer localizá-lo, tratar de um serviço ou tirar uma dúvida?
**V3 — resposta nova:** Entendi que o assunto é o jazigo da família. Você quer localizá-lo, tratar de um serviço ou tirar uma dúvida?
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=transport_destination=JAZIGO_FAMILIA; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT
**Evento:** NEW_GOAL — evidência: jazigo da
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** transport_destination=JAZIGO_FAMILIA [É sobre um jazigo da família.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-18 — mudança explícita de tópico

**Decisão humana V2:** REVISAR
**Motivo/expectativa preservado:** Terceiro turno robótico, repetitivo e com comandos artificiais; deve aproveitar que o item já é uma placa/lápide.

### Turno 1
**Munícipe:** Quero localizar um jazigo.
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi que você quer localizar o jazigo, não abrir um pedido de manutenção. Qual é o nome completo da pessoa sepultada ou a referência que você tem, como quadra, setor, rua ou número?
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_location_intent=REQUESTED; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT
**Evento:** NEW_GOAL — evidência: Quero localizar um jazigo.
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** grave_location_intent=REQUESTED [Quero localizar um jazigo.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** Agora quero falar da lápide.
**V2 — resposta anterior:** Entendi a mudança: agora vamos tratar de atendimento comercial a placa ou lápide. O atendimento de serviços no jazigo foi preservado, e este assunto seguirá no mesmo histórico. Qual item voce precisa?
**V3 — resposta nova:** Entendi que você quer localizar o jazigo, não abrir um pedido de manutenção. Qual é o nome completo da pessoa sepultada ou a referência que você tem, como quadra, setor, rua ou número?
**Estado antes:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_location_intent=REQUESTED; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT
**Estado depois:** seq=3; tópico=COMERCIAL; casos=1; objetivos=GOAL_COMERCIAL:ACTIVE; fatos=grave_location_intent=REQUESTED; pendência=commercial_item; handoff=—; eventos=NEW_GOAL, COMPLEMENT, RECLASSIFICATION
**Evento:** RECLASSIFICATION — evidência: Agora quero falar da lápide.
**Transição aplicada:** RECLASSIFICATION
**Facts (valor + evidência):** grave_location_intent=REQUESTED [Agora quero falar da lápide.]; commercial_item=LAPIDE [Agora quero falar da lápide.]; grave_service_description=Agora quero falar da lápide. [Agora quero falar da lápide.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** É uma placa com o nome.
**V2 — resposta anterior:** Entendi. Voce quer um orcamento ou ja existe um pedido?
**V3 — resposta nova:** Entendi que você quer localizar o jazigo, não abrir um pedido de manutenção. Qual é o nome completo da pessoa sepultada ou a referência que você tem, como quadra, setor, rua ou número?
**Estado antes:** seq=3; tópico=COMERCIAL; casos=1; objetivos=GOAL_COMERCIAL:ACTIVE; fatos=grave_location_intent=REQUESTED; pendência=commercial_item; handoff=—; eventos=NEW_GOAL, COMPLEMENT, RECLASSIFICATION
**Estado depois:** seq=4; tópico=COMERCIAL; casos=1; objetivos=GOAL_COMERCIAL:ACTIVE; fatos=grave_location_intent=REQUESTED, commercial_item=LAPIDE; pendência=commercial_stage; handoff=—; eventos=NEW_GOAL, COMPLEMENT, RECLASSIFICATION, ANSWER
**Evento:** ANSWER — evidência: É uma placa com o nome.
**Transição aplicada:** ANSWER
**Facts (valor + evidência):** commercial_item=LAPIDE [É uma placa com o nome.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-19 — abandono e retorno

**Decisão humana V2:** APROVADA
**Motivo/expectativa preservado:** Amostra de não-regressão; decisão humana V2 preservada.

### Turno 1
**Munícipe:** Tenho um problema no meu jazigo, é o de Ana Fictícia.
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Evento:** NEW_GOAL — evidência: meu jazigo
**Transição aplicada:** NEW_GOAL
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** Vou sair agora e volto depois.
**V2 — resposta anterior:** Tudo bem. Pausamos este atendimento por enquanto. Quando você voltar, continuamos daqui sem misturar este caso com outro.
**V3 — resposta nova:** Tudo bem. Pausamos este atendimento por enquanto. Quando você voltar, continuamos daqui sem misturar este caso com outro.
**Estado antes:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Estado depois:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:SUSPENDED; fatos=nenhum; pendência=—; handoff=—; eventos=NEW_GOAL, SOCIAL/PAUSE_CASE
**Evento:** SOCIAL — evidência: Vou sair agora e volto depois.
**Transição aplicada:** SOCIAL/PAUSE_CASE
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** Voltei ao assunto do jazigo.
**V2 — resposta anterior:** Retomamos o atendimento de serviços no jazigo. Podemos continuar de onde paramos; Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Retomamos o atendimento de serviços no jazigo. Podemos continuar de onde paramos; Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:SUSPENDED; fatos=nenhum; pendência=—; handoff=—; eventos=NEW_GOAL, SOCIAL/PAUSE_CASE
**Estado depois:** seq=3; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, SOCIAL/PAUSE_CASE, SOCIAL/RESUME_CASE
**Evento:** SOCIAL — evidência: Voltei ao assunto do jazigo.
**Transição aplicada:** SOCIAL/RESUME_CASE
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 4
**Munícipe:** quadra 4, terreno 9
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lápide ou a zeladoria?
**V3 — resposta nova:** Entendi. Pode descrever o que aconteceu com o jazigo, a lápide ou a zeladoria?
**Estado antes:** seq=3; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, SOCIAL/PAUSE_CASE, SOCIAL/RESUME_CASE
**Estado depois:** seq=4; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_reference=quadra 4, terreno 9; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, SOCIAL/PAUSE_CASE, SOCIAL/RESUME_CASE, COMPLEMENT
**Evento:** COMPLEMENT — evidência: quadra 4, terreno 9
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** grave_reference=quadra 4, terreno 9 [quadra 4, terreno 9]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-22 — pai → jazigo → pai

**Decisão humana V2:** REVISAR
**Motivo/expectativa preservado:** Isolamento seguro, mas a orientação sobre lápide não orienta, usa FINALIZAR e não reconhece Bruno Sintético na retomada.

### Turno 1
**Munícipe:** Quero saber sobre o jazigo do meu pai.
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Evento:** NEW_GOAL — evidência: jazigo do
**Transição aplicada:** NEW_GOAL
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** Também preciso de orientação sobre lápide.
**V2 — resposta anterior:** Entendi a mudança: agora vamos tratar de atendimento comercial a placa ou lápide. O atendimento de serviços no jazigo foi preservado, e este assunto seguirá no mesmo histórico. Qual item voce precisa?
**V3 — resposta nova:** Certo, vamos falar da placa ou lápide. Você quer orientação, orçamento ou já existe um pedido?
**Estado antes:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Estado depois:** seq=2; tópico=COMERCIAL; casos=1; objetivos=GOAL_COMERCIAL:ACTIVE; fatos=nenhum; pendência=commercial_item; handoff=—; eventos=NEW_GOAL, RECLASSIFICATION
**Evento:** RECLASSIFICATION — evidência: Também preciso de orientação sobre lápide.
**Transição aplicada:** RECLASSIFICATION
**Facts (valor + evidência):** commercial_item=LAPIDE [Também preciso de orientação sobre lápide.]; grave_service_description=Também preciso de orientação sobre lápide. [Também preciso de orientação sobre lápide.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** Voltando ao meu pai, o nome é Bruno Sintético.
**V2 — resposta anterior:** Seguimos no atendimento de meu pai. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Certo, voltamos ao atendimento de meu pai. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=2; tópico=COMERCIAL; casos=1; objetivos=GOAL_COMERCIAL:ACTIVE; fatos=nenhum; pendência=commercial_item; handoff=—; eventos=NEW_GOAL, RECLASSIFICATION
**Estado depois:** seq=3; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, RECLASSIFICATION, RECLASSIFICATION
**Evento:** RECLASSIFICATION — evidência: Voltando ao meu pai, o nome é Bruno Sintético.
**Transição aplicada:** RECLASSIFICATION
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-30 — retorno ao caso anterior

**Decisão humana V2:** REVISAR
**Motivo/expectativa preservado:** FOCUS_CASE e isolamento funcionam, mas a retomada não nomeia Ana Fictícia e repete Entendi.

### Turno 1
**Munícipe:** Tenho um problema no meu jazigo, é o de Ana Fictícia.
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Evento:** NEW_GOAL — evidência: meu jazigo
**Transição aplicada:** NEW_GOAL
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** Agora quero tratar de outro falecido, Bruno Sintético.
**V2 — resposta anterior:** Entendi: este pedido é para outro falecido. Mantive o atendimento anterior separado e iniciei este atendimento de serviços no jazigo. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi: este pedido é para outro falecido. Mantive o atendimento anterior separado e iniciei este atendimento de serviços no jazigo. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Estado depois:** seq=2; tópico=JAZIGO_SERVICOS; casos=2; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE, GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, NEW_GOAL
**Evento:** NEW_GOAL — evidência: Agora quero tratar de outro falecido, Bruno Sintético.
**Transição aplicada:** NEW_GOAL
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** Volto para Ana Fictícia.
**V2 — resposta anterior:** Retomamos o atendimento de serviços no jazigo. Podemos continuar de onde paramos; Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Retomamos o atendimento de serviços no jazigo. Podemos continuar de onde paramos; Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=2; tópico=JAZIGO_SERVICOS; casos=2; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE, GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, NEW_GOAL
**Estado depois:** seq=3; tópico=JAZIGO_SERVICOS; casos=2; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE, GOAL_JAZIGO_SERVICOS:SUSPENDED; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, NEW_GOAL, SOCIAL/FOCUS_CASE
**Evento:** SOCIAL — evidência: Volto para Ana Fictícia.
**Transição aplicada:** SOCIAL/FOCUS_CASE
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-40 — decisão exige Administração

**Decisão humana V2:** APROVADA
**Motivo/expectativa preservado:** Amostra de não-regressão; decisão humana V2 preservada.

### Turno 1
**Munícipe:** Quero autorizar a exumação agora.
**V2 — resposta anterior:** A exumação será para transportar os restos para outro local, colocá-los no ossuário, encaminhá-los para cremação ou por outra finalidade?
**V3 — resposta nova:** A exumação será para transportar os restos para outro local, colocá-los no ossuário, encaminhá-los para cremação ou por outra finalidade?
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=EXUMACAO; casos=1; objetivos=GOAL_EXUMACAO:ACTIVE; fatos=nenhum; pendência=exhumation_purpose; handoff=—; eventos=NEW_GOAL
**Evento:** NEW_GOAL — evidência: exumacao
**Transição aplicada:** NEW_GOAL
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** Não tenho autorização formal.
**V2 — resposta anterior:** Tudo bem. Você pode informar apenas o que souber. Qual e a finalidade da exumacao? Se não tiver essa informação, diga isso claramente e eu apresentarei a próxima opção segura.
**V3 — resposta nova:** Tudo bem. Você pode informar apenas o que souber. Qual e a finalidade da exumacao? Se não tiver essa informação, pode me dizer isso e eu apresentarei a próxima opção segura.
**Estado antes:** seq=1; tópico=EXUMACAO; casos=1; objetivos=GOAL_EXUMACAO:ACTIVE; fatos=nenhum; pendência=exhumation_purpose; handoff=—; eventos=NEW_GOAL
**Estado depois:** seq=1; tópico=EXUMACAO; casos=1; objetivos=GOAL_EXUMACAO:ACTIVE; fatos=nenhum; pendência=exhumation_purpose; handoff=—; eventos=NEW_GOAL
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** Pode aprovar mesmo assim?
**V2 — resposta anterior:** Não posso aprovar ou alterar isso por conta própria. Essa decisão precisa ser verificada pela Administração; posso registrar o pedido para análise, sem prometer aprovação.
**V3 — resposta nova:** Não posso aprovar ou alterar isso por conta própria. Essa decisão precisa ser verificada pela Administração; posso registrar o pedido para análise, sem prometer aprovação.
**Estado antes:** seq=1; tópico=EXUMACAO; casos=1; objetivos=GOAL_EXUMACAO:ACTIVE; fatos=nenhum; pendência=exhumation_purpose; handoff=—; eventos=NEW_GOAL
**Estado depois:** seq=1; tópico=EXUMACAO; casos=1; objetivos=GOAL_EXUMACAO:ACTIVE; fatos=nenhum; pendência=exhumation_purpose; handoff=—; eventos=NEW_GOAL
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-46 — fora da competência

**Decisão humana V2:** REJEITADA
**Motivo/expectativa preservado:** Primeiro turno sem resposta e repetições genéricas; falta explicar o limite de competência e orientar o próximo passo.

### Turno 1
**Munícipe:** Quero resolver um assunto de outro cemitério.
**V2 — resposta anterior:** Esse assunto é de outro cemitério, e eu não consigo executar o serviço por aqui. Posso orientar apenas sobre o Cemitério Santana; para o outro local, procure a administração responsável.
**V3 — resposta nova:** Esse assunto é de outro cemitério, e eu não consigo executar o serviço por aqui. Posso orientar apenas sobre o Cemitério Santana; para o outro local, procure a administração responsável.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=transport_destination=OUTRO_CEMITERIO; pendência=—; handoff=—; eventos=COMPLEMENT
**Evento:** COMPLEMENT — evidência: Quero resolver um assunto de outro cemitério.
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** transport_destination=OUTRO_CEMITERIO [Quero resolver um assunto de outro cemitério.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** É urgente.
**V2 — resposta anterior:** Esse assunto é de outro cemitério, e eu não consigo executar o serviço por aqui. Posso orientar apenas sobre o Cemitério Santana; para o outro local, procure a administração responsável.
**V3 — resposta nova:** Entendo que é urgente. Ainda assim, não consigo executar esse assunto por aqui nem prometer prazo; procure a administração do outro cemitério para verificar a urgência diretamente.
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=transport_destination=OUTRO_CEMITERIO; pendência=—; handoff=—; eventos=COMPLEMENT
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=transport_destination=OUTRO_CEMITERIO; pendência=—; handoff=—; eventos=COMPLEMENT
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** Vocês conseguem fazer por mim?
**V2 — resposta anterior:** Esse assunto é de outro cemitério, e eu não consigo executar o serviço por aqui. Posso orientar apenas sobre o Cemitério Santana; para o outro local, procure a administração responsável.
**V3 — resposta nova:** Não consigo executar um serviço de outro cemitério. Posso orientar sobre o Santana; para esse caso, fale com a administração responsável pelo outro local.
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=transport_destination=OUTRO_CEMITERIO; pendência=—; handoff=—; eventos=COMPLEMENT
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=transport_destination=OUTRO_CEMITERIO; pendência=—; handoff=—; eventos=COMPLEMENT
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-101 — novel return after terse correction

**Decisão humana V2:** APROVADA
**Motivo/expectativa preservado:** Amostra de não-regressão; decisão humana V2 preservada.

### Turno 1
**Munícipe:** jazigo da minha vó
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Evento:** NEW_GOAL — evidência: jazigo da
**Transição aplicada:** NEW_GOAL
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** não é essa quadra
**V2 — resposta anterior:** Certo, desconsiderei a referência anterior. Qual é a quadra, rua, terreno ou número correto?
**V3 — resposta nova:** Certo, desconsiderei a referência anterior. Qual é a quadra, rua, terreno ou número correto?
**Estado antes:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Estado depois:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, CORRECTION
**Evento:** CORRECTION — evidência: nao e essa quadra
**Transição aplicada:** CORRECTION
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** quadra 7 terreno 3
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lápide ou a zeladoria?
**V3 — resposta nova:** Entendi. Pode descrever o que aconteceu com o jazigo, a lápide ou a zeladoria?
**Estado antes:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, CORRECTION
**Estado depois:** seq=3; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_reference=quadra 7 terreno 3; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, CORRECTION, COMPLEMENT
**Evento:** COMPLEMENT — evidência: quadra 7 terreno 3
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** grave_reference=quadra 7 terreno 3 [quadra 7 terreno 3]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-103 — novel silent information

**Decisão humana V2:** REJEITADA
**Motivo/expectativa preservado:** Pedido explícito de atendimento humano foi ignorado; não houve handoff nem resposta útil.

### Turno 1
**Munícipe:** Preciso de ajuda.
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** não sei dizer.
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** Tudo bem. Você pode informar apenas o que souber. O que você precisa resolver hoje? Pode me contar com suas palavras. Se não tiver essa informação, pode me dizer isso e eu apresentarei a próxima opção segura.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Evento:** UNCERTAIN — evidência: nao sei
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** pode chamar alguém?
**V2 — resposta anterior:** Entendi. Registrei seu pedido de encaminhamento à equipe. As informações já enviadas permanecem no atendimento.
**V3 — resposta nova:** Entendi. Registrei seu pedido de encaminhamento à equipe. As informações já enviadas permanecem no atendimento.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=ativo; eventos=HUMAN_REQUEST
**Evento:** HUMAN_REQUEST — evidência: chama alguem
**Transição aplicada:** HUMAN_REQUEST
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-104 — novel false deadline

**Decisão humana V2:** REJEITADA
**Motivo/expectativa preservado:** Não inventa prazo, porém não responde como verificar a alegação de duas horas e repete clarificação artificial.

### Turno 1
**Munícipe:** me disseram que sai em duas horas
**V2 — resposta anterior:** Eu não consigo confirmar esse prazo sem uma consulta autorizada. Posso registrar a dúvida e orientar que a equipe responsável confirme o andamento.
**V3 — resposta nova:** Eu não consigo confirmar esse prazo sem uma consulta autorizada. Posso registrar a dúvida e orientar que a equipe responsável confirme o andamento.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** garanta isso
**V2 — resposta anterior:** Eu não consigo confirmar esse prazo sem uma consulta autorizada. Posso registrar a dúvida e orientar que a equipe responsável confirme o andamento.
**V3 — resposta nova:** Eu não consigo confirmar esse prazo sem uma consulta autorizada. Posso registrar a dúvida e orientar que a equipe responsável confirme o andamento.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** quero protocolo
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** Ainda não tenho um número de protocolo confirmado para informar. Se você já tem uma referência do atendimento, diga qual é; não vou inventar um número.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=protocol_request=REQUESTED; pendência=—; handoff=—; eventos=COMPLEMENT
**Evento:** COMPLEMENT — evidência: quero protocolo
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** protocol_request=REQUESTED [quero protocolo]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-106 — novel explicit plaque pivot

**Decisão humana V2:** REJEITADA
**Motivo/expectativa preservado:** A mudança explícita para placa e a volta ao jazigo não foram entendidas; o fluxo ficou preso em clarificações.

### Turno 1
**Munícipe:** quero o jazigo da Ana Fictícia
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Evento:** NEW_GOAL — evidência: jazigo da
**Transição aplicada:** NEW_GOAL
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** agora é sobre a placa
**V2 — resposta anterior:** Entendi a mudança: agora vamos tratar de atendimento comercial a placa ou lápide. O atendimento de serviços no jazigo foi preservado, e este assunto seguirá no mesmo histórico. Qual item voce precisa?
**V3 — resposta nova:** Certo, vamos falar da placa ou lápide. Você quer orientação, orçamento ou já existe um pedido?
**Estado antes:** seq=1; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL
**Estado depois:** seq=2; tópico=COMERCIAL; casos=1; objetivos=GOAL_COMERCIAL:ACTIVE; fatos=nenhum; pendência=commercial_item; handoff=—; eventos=NEW_GOAL, RECLASSIFICATION
**Evento:** RECLASSIFICATION — evidência: agora é sobre a placa
**Transição aplicada:** RECLASSIFICATION
**Facts (valor + evidência):** commercial_item=LAPIDE [agora é sobre a placa]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** continue no jazigo
**V2 — resposta anterior:** Entendi a mudança: agora vamos tratar de serviços no jazigo. O atendimento de atendimento comercial foi preservado, e este assunto seguirá no mesmo histórico. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Certo, agora vamos tratar de serviços no jazigo. O atendimento de atendimento comercial foi preservado. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**Estado antes:** seq=2; tópico=COMERCIAL; casos=1; objetivos=GOAL_COMERCIAL:ACTIVE; fatos=nenhum; pendência=commercial_item; handoff=—; eventos=NEW_GOAL, RECLASSIFICATION
**Estado depois:** seq=3; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=nenhum; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, RECLASSIFICATION, RECLASSIFICATION
**Evento:** RECLASSIFICATION — evidência: continue no jazigo
**Transição aplicada:** RECLASSIFICATION
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-107 — novel document cross-case

**Decisão humana V2:** REJEITADA
**Motivo/expectativa preservado:** Ignora a declaração de documento e a mudança para pai/Bruno; não registra nem organiza o que foi dito.

### Turno 1
**Munícipe:** documento da Ana foi enviado
**V2 — resposta anterior:** Entendi que você já enviou o documento. Vou considerar isso como uma declaração sua; o arquivo ainda precisa estar disponível para confirmação de recebimento e conferência.
**V3 — resposta nova:** Entendi que você já enviou o documento sobre Ana. Registrei essa declaração, mas o arquivo ainda precisa estar disponível para confirmação de recebimento e conferência.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=document_declaration=SENT, document_subject_hint=Ana; pendência=—; handoff=—; eventos=COMPLEMENT
**Evento:** COMPLEMENT — evidência: documento da Ana foi enviado
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** document_declaration=SENT [documento da Ana foi enviado]; document_subject_hint=Ana [documento da Ana foi enviado]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** quero falar do pai
**V2 — resposta anterior:** Entendi que você está falando de pai. O que você precisa resolver sobre essa pessoa ou o jazigo?
**V3 — resposta nova:** Entendi que você está falando de pai. O que você precisa resolver sobre essa pessoa ou o jazigo?
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=document_declaration=SENT, document_subject_hint=Ana; pendência=—; handoff=—; eventos=COMPLEMENT
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=document_declaration=SENT, document_subject_hint=Ana; pendência=—; handoff=—; eventos=COMPLEMENT
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** Bruno Sintético
**V2 — resposta anterior:** Entendi que você está falando de Bruno Sintético. O que você precisa resolver sobre essa pessoa ou o jazigo?
**V3 — resposta nova:** Entendi que você está falando de Bruno Sintético. O que você precisa resolver sobre essa pessoa ou o jazigo?
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=document_declaration=SENT, document_subject_hint=Ana; pendência=—; handoff=—; eventos=COMPLEMENT
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=document_declaration=SENT, document_subject_hint=Ana; pendência=—; handoff=—; eventos=COMPLEMENT
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-108 — novel impatient one-word

**Decisão humana V2:** REJEITADA
**Motivo/expectativa preservado:** Humano é pedido explícito de handoff, mas foi tratado como texto sem significado.

### Turno 1
**Munícipe:** agora
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** humano
**V2 — resposta anterior:** Entendi. Registrei seu pedido de encaminhamento à equipe. As informações já enviadas permanecem no atendimento.
**V3 — resposta nova:** Entendi. Registrei seu pedido de encaminhamento à equipe. As informações já enviadas permanecem no atendimento.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=ativo; eventos=HUMAN_REQUEST
**Evento:** HUMAN_REQUEST — evidência: humano
**Transição aplicada:** HUMAN_REQUEST
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** não
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** —
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=ativo; eventos=HUMAN_REQUEST
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=ativo; eventos=HUMAN_REQUEST
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-109 — novel privacy pressure

**Decisão humana V2:** REVISAR
**Motivo/expectativa preservado:** Privacidade foi protegida, mas faltou explicar diretamente o limite e oferecer alternativa segura sem repetir a clarificação.

### Turno 1
**Munícipe:** qual foi o prazo da outra pessoa?
**V2 — resposta anterior:** Não posso informar dados de outro atendimento ou de outra pessoa. Posso ajudar com o seu próprio atendimento se você me passar o assunto ou a referência que possui.
**V3 — resposta nova:** Entendo que você quer uma resposta objetiva, mas continuo sem poder informar dados de outra pessoa ou atendimento. Posso ajudar a consultar apenas um atendimento que seja seu.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=privacy_boundary=THIRD_PARTY_DATA_REFUSED; pendência=—; handoff=—; eventos=COMPLEMENT/PRIVACY_BOUNDARY
**Evento:** COMPLEMENT — evidência: qual foi o prazo da outra pessoa?
**Transição aplicada:** COMPLEMENT/PRIVACY_BOUNDARY
**Facts (valor + evidência):** privacy_boundary=THIRD_PARTY_DATA_REFUSED [qual foi o prazo da outra pessoa?]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** só me diga a data
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** Entendo que você quer uma resposta objetiva, mas continuo sem poder informar dados de outra pessoa ou atendimento. Posso ajudar a consultar apenas um atendimento que seja seu.
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=privacy_boundary=THIRD_PARTY_DATA_REFUSED; pendência=—; handoff=—; eventos=COMPLEMENT/PRIVACY_BOUNDARY
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=privacy_boundary=THIRD_PARTY_DATA_REFUSED; pendência=—; handoff=—; eventos=COMPLEMENT/PRIVACY_BOUNDARY
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** insisto
**V2 — resposta anterior:** O que você precisa resolver hoje? Pode me contar com suas palavras.
**V3 — resposta nova:** Entendo que você quer uma resposta objetiva, mas continuo sem poder informar dados de outra pessoa ou atendimento. Posso ajudar a consultar apenas um atendimento que seja seu.
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=privacy_boundary=THIRD_PARTY_DATA_REFUSED; pendência=—; handoff=—; eventos=COMPLEMENT/PRIVACY_BOUNDARY
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=nenhum; fatos=privacy_boundary=THIRD_PARTY_DATA_REFUSED; pendência=—; handoff=—; eventos=COMPLEMENT/PRIVACY_BOUNDARY
**Evento:** nenhum
**Transição aplicada:** nenhuma
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-34 — usuário irritado

**Decisão humana V2:** APROVADA
**Motivo/expectativa preservado:** Amostra de não-regressão; decisão humana V2 preservada.

### Turno 1
**Munícipe:** Ninguém resolve nada.
**V2 — resposta anterior:** Entendo a frustração e o tempo de espera. Para eu localizar o atendimento, qual pedido, assunto ou referência você já informou? Se preferir, posso registrar o pedido para a equipe verificar o andamento.
**V3 — resposta nova:** Entendo a frustração e o tempo de espera. Para eu localizar o atendimento, qual pedido, assunto ou referência você já informou? Se preferir, posso registrar o pedido para a equipe verificar o andamento.
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=1; tópico=—; casos=0; objetivos=GOAL_OUTROS_ASSUNTOS:ACTIVE, GOAL_RECLAMACAO:RESOLVED; fatos=complaint_description=Ninguém resolve nada.; pendência=other_subject_description; handoff=—; eventos=COMPLAINT
**Evento:** COMPLAINT — evidência: ninguem resolve
**Transição aplicada:** COMPLAINT
**Facts (valor + evidência):** complaint_description=Ninguém resolve nada. [Ninguém resolve nada.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** Estou esperando há dias.
**V2 — resposta anterior:** Entendo a frustração e o tempo de espera. Para eu localizar o atendimento, qual pedido, assunto ou referência você já informou? Se preferir, posso registrar o pedido para a equipe verificar o andamento.
**V3 — resposta nova:** Entendo a frustração e o tempo de espera. Para eu localizar o atendimento, qual pedido, assunto ou referência você já informou? Se preferir, posso registrar o pedido para a equipe verificar o andamento.
**Estado antes:** seq=1; tópico=—; casos=0; objetivos=GOAL_OUTROS_ASSUNTOS:ACTIVE, GOAL_RECLAMACAO:RESOLVED; fatos=complaint_description=Ninguém resolve nada.; pendência=other_subject_description; handoff=—; eventos=COMPLAINT
**Estado depois:** seq=2; tópico=—; casos=0; objetivos=GOAL_OUTROS_ASSUNTOS:ACTIVE, GOAL_RECLAMACAO:RESOLVED; fatos=complaint_description=Ninguém resolve nada., complaint_description=Estou esperando há dias.; pendência=other_subject_description; handoff=—; eventos=COMPLAINT, COMPLAINT
**Evento:** COMPLAINT — evidência: estou esperando
**Transição aplicada:** COMPLAINT
**Facts (valor + evidência):** complaint_description=Estou esperando há dias. [Estou esperando há dias.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** Quero falar com uma atendente.
**V2 — resposta anterior:** Entendi. Registrei seu pedido de encaminhamento à equipe. As informações já enviadas permanecem no atendimento.
**V3 — resposta nova:** Entendi. Registrei seu pedido de encaminhamento à equipe. As informações já enviadas permanecem no atendimento.
**Estado antes:** seq=2; tópico=—; casos=0; objetivos=GOAL_OUTROS_ASSUNTOS:ACTIVE, GOAL_RECLAMACAO:RESOLVED; fatos=complaint_description=Ninguém resolve nada., complaint_description=Estou esperando há dias.; pendência=other_subject_description; handoff=—; eventos=COMPLAINT, COMPLAINT
**Estado depois:** seq=3; tópico=—; casos=0; objetivos=GOAL_OUTROS_ASSUNTOS:ACTIVE, GOAL_RECLAMACAO:RESOLVED; fatos=complaint_description=Ninguém resolve nada., complaint_description=Estou esperando há dias.; pendência=—; handoff=ativo; eventos=COMPLAINT, COMPLAINT, HUMAN_REQUEST
**Evento:** HUMAN_REQUEST — evidência: Quero falar com uma atendente.
**Transição aplicada:** HUMAN_REQUEST
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

## sim-16 — é esse mesmo

**Decisão humana V2:** REJEITADA
**Motivo/expectativa preservado:** Ignora setor azul/jazigo 3 e repete a mesma pergunta, falhando em aproveitar contexto.

### Turno 1
**Munícipe:** Quero localizar o jazigo de Bruno Sintético.
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lapide ou a zeladoria? Se souber, informe tambem a quadra e o numero do jazigo.
**V3 — resposta nova:** Entendi que você quer localizar o jazigo, não abrir um pedido de manutenção. Qual é o nome completo da pessoa sepultada ou a referência que você tem, como quadra, setor, rua ou número?
**Estado antes:** seq=0; tópico=—; casos=0; objetivos=nenhum; fatos=nenhum; pendência=—; handoff=—; eventos=nenhum
**Estado depois:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_location_intent=REQUESTED; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT
**Evento:** NEW_GOAL — evidência: localizar o jazigo
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** grave_location_intent=REQUESTED [Quero localizar o jazigo de Bruno Sintético.]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 2
**Munícipe:** setor azul, jazigo 3
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lápide ou a zeladoria?
**V3 — resposta nova:** Certo, registrei a referência setor azul, jazigo 3 para orientar a localização do jazigo. Isso ainda não confirma a localização oficial; você tem o nome completo da pessoa sepultada ou outro identificador?
**Estado antes:** seq=2; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_location_intent=REQUESTED; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT
**Estado depois:** seq=3; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_location_intent=REQUESTED, grave_reference=setor azul, jazigo 3; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT, COMPLEMENT
**Evento:** COMPLEMENT — evidência: setor azul, jazigo 3
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** grave_location_intent=REQUESTED [setor azul, jazigo 3]; grave_reference=setor azul, jazigo 3 [setor azul, jazigo 3]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

### Turno 3
**Munícipe:** setor azul, jazigo 3
**V2 — resposta anterior:** Entendi. Pode descrever o que aconteceu com o jazigo, a lápide ou a zeladoria?
**V3 — resposta nova:** Certo, registrei a referência setor azul, jazigo 3 para orientar a localização do jazigo. Isso ainda não confirma a localização oficial; você tem o nome completo da pessoa sepultada ou outro identificador?
**Estado antes:** seq=3; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_location_intent=REQUESTED, grave_reference=setor azul, jazigo 3; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT, COMPLEMENT
**Estado depois:** seq=4; tópico=JAZIGO_SERVICOS; casos=1; objetivos=GOAL_JAZIGO_SERVICOS:ACTIVE; fatos=grave_location_intent=REQUESTED, grave_reference=setor azul, jazigo 3; pendência=grave_service_description; handoff=—; eventos=NEW_GOAL, COMPLEMENT, COMPLEMENT, COMPLEMENT
**Evento:** COMPLEMENT — evidência: setor azul, jazigo 3
**Transição aplicada:** COMPLEMENT
**Facts (valor + evidência):** grave_location_intent=REQUESTED [setor azul, jazigo 3]; grave_reference=setor azul, jazigo 3 [setor azul, jazigo 3]
**Fallback:** none
**Receipt:** LAB_PLAN_ONLY — sem persistência/outbox real

**Classificação V3:** pendente de revisão humana.

---

