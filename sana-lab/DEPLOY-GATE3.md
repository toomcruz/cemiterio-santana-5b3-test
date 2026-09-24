# Gate 3 — implantação privada: checkpoint operacional

**Status observado 24/09/2026:** o executor desta sessão não dispõe de `docker`, `/var/run/docker.sock`, sessão SSH da VPS ou navegador administrativo autenticado. A rede Docker real do n8n **não foi inspecionada**; nome, subnet e DNS real permanecem desconhecidos. Nenhum container foi criado. O workflow LAB `m6y2AD8Vx1QZaJiE` não foi alterado.

Os arquivos `sana-lab/Dockerfile` e `sana-lab/compose.lab.yaml` preparam a implantação do commit desta branch. Compose exige `SANA_N8N_DOCKER_NETWORK` e diretórios/segredo LAB no host. A porta **não** tem `ports`; `EXPOSE 8765` é metadado interno da imagem. A bridge aceita `0.0.0.0` apenas quando `SANA_LAB_BIND_HOST` é configurado; o padrão continua `127.0.0.1`.

## Inspeção a executar na VPS, somente leitura primeiro

```sh
docker ps --format '{{.Names}} {{.Networks}} {{.Ports}}'
docker inspect <nome-real-container-n8n> --format '{{json .NetworkSettings.Networks}}'
docker network inspect <nome-real-rede-n8n> --format '{{.Name}} {{json .IPAM.Config}} {{.Driver}} {{.Internal}}'
```

Selecionar a rede efetivamente compartilhável, verificar se o n8n resolve aliases nessa rede, e confirmar que anexar um novo serviço não afeta o container existente. **Não inferir rede de domínio público do n8n.**

## Implantação condicionada à inspeção

1. Conferir checkout exato da branch/commit e construir a imagem a partir dele; não usar arquivos de outro checkout.
2. Criar diretório LAB isolado no host com permissão de escrita apenas para o UID do container. Criar arquivo de token LAB com modo `0600`, fora do repo e sem exibir seu conteúdo. Definir apenas os caminhos e o nome real da rede nas variáveis exigidas por Compose.
3. Verificar `docker compose -f sana-lab/compose.lab.yaml config` e confirmar que **nenhum** `ports` foi introduzido. Subir apenas `sana-lab-bridge`; confirmar `docker ps` e `docker inspect` sem porta publicada.
4. De dentro do n8n, verificar `sana-lab-bridge` via DNS Docker; uma chamada sem token deve retornar 401. Uma chamada com credencial LAB deve retornar 200 e `sana-lab-bridge/1` para evento sintético. Não imprimir o header Bearer, corpo com dados reais nem variáveis secretas.
5. Criar credencial de HTTP Header Auth no n8n pela interface segura; o conector n8n disponível aqui apenas lista credenciais. Atribuir somente ao workflow LAB e restringir visibilidade conforme projeto. O token não entra no JSON de nós.
6. Atualizar o workflow LAB com HTTP Request para `http://sana-lab-bridge:8765/lab/v1/turn` e validador de resposta. Somente depois executar A–F e as falhas no executor n8n, registrando cada ID. Não publicar.

## Critérios da resposta n8n

Validar `contract_version=sana-lab-bridge/1`, `case_id` igual ao enviado, `previous_revision` igual ao estado esperado, `new_revision` inteiro, `module=EXUMACAO`, `evidence.engine_called=true`, `state.schema_version=sana-lab/1`, listas de autoridade e operações bem formadas e `duplicate` booleano. Para HTTP 401/403/409/5xx, timeout, JSON inválido ou campo ausente, a execução termina com erro LAB; não produzir resposta ao munícipe nem fallback de negócio.

**Gate = BLOCKED** até a rede real, token guardado no runtime e credencial n8n, chamada autenticada, A–F com IDs de execução e testes de falha no n8n serem demonstrados. O canário `qxEGiuRNYEOT8smE` não participa.
