FROM denoland/deno:2.1.4
WORKDIR /app
COPY deno.json ./
COPY sana-lab/ ./sana-lab/
COPY santana-authority-gateway/ ./santana-authority-gateway/
COPY santana-authority/ ./santana-authority/
COPY santana-conversation-domain/ ./santana-conversation-domain/
COPY conformidade/ ./conformidade/
USER deno
ENV SANA_LAB_STATE_DIR=/lab-state SANA_LAB_BIND_HOST=0.0.0.0 SANA_LAB_PORT=8765 SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token
EXPOSE 8765
CMD ["run", "--allow-read=/app/santana-authority,/app/santana-conversation-domain,/app/conformidade,/lab-state,/run/secrets/sana_lab_token", "--allow-write=/lab-state", "--allow-net=0.0.0.0:8765", "--allow-env=SANA_LAB_STATE_DIR,SANA_LAB_BIND_HOST,SANA_LAB_PORT,SANA_LAB_TOKEN_FILE,SANTANA_CATALOGO_OFICIAL,SANTANA_REPO_ROOT,SANTANA_PERFIL_EXUMACAO", "sana-lab/start.ts"]
