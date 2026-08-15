# P01–P15 — execução somente em Supabase/PostgreSQL descartável

Cada arquivo abre uma transação e termina em `ROLLBACK`; use `psql -v ON_ERROR_STOP=1 -f arquivo.sql`. P01, P09 e P11
possuem também o orquestrador `run_concurrency.sh`, que requer duas conexões `DATABASE_URL_A` e `DATABASE_URL_B`. Nenhum
script usa W-API, n8n, Gemini ou qualquer tabela legada.

`verify_static.sh` verifica apenas estrutura local; a sua mensagem de PASS não prova comportamento PostgreSQL. A prova
dinâmica dos cenários continua restrita a PostgreSQL/Supabase isolado e descartável.
