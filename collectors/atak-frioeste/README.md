# Coletor ATAK -> PS Gestao (Frioeste)

Roda DENTRO da rede Frioeste. Le o abate do SQL Server ATAK
(`SATKFRIOESTE.dbo.tbRomaneioAbate`, read-only) e empurra pro Supabase
via Edge Function `atak-ingest` (upsert idempotente).

## Instalacao (uma vez)
1. Instalar Node.js 18+ na maquina (precisa de `fetch` nativo).
2. Copiar a pasta `atak-frioeste` para a maquina.
3. `cd atak-frioeste && npm install`
4. Copiar `.env.example` para `.env` e preencher `INGEST_SECRET`
   (o mesmo segredo configurado no Edge `ATAK_INGEST_SECRET`).

## Rodar manualmente (teste)
```
npm start
```

## Agendar (Windows Task Scheduler — a cada 30 min)
- Programa: `node`
- Argumentos: `collector.js`
- Iniciar em: `C:\caminho\atak-frioeste`
- Carregar o `.env`: usar um `.bat` que faca `cd` + `node collector.js`,
  ou um wrapper com `dotenv`.

## Como funciona
- Janela movel de N dias (default 5) por `Data_abate` -> reprocessa e
  corrige (peso resfriado / aspersao preenchidos depois do abate).
- `UNIQUE (company, filial, chave_fato, seq_cabeca)` -> upsert: nunca
  duplica.
- Idempotente: pode rodar quantas vezes quiser.

## Segredo do Edge (apos deploy)
```
supabase secrets set ATAK_INGEST_SECRET="<segredo-forte-aleatorio>" \
  --project-ref horsymhsinqcimflrtjo
```
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` ja existem no runtime.

## Auditoria (Eng Chefe via MCP) pos-1a-rodada
```sql
-- volume e frescor
SELECT COUNT(*) AS cabecas, MIN(data_abate) AS de, MAX(data_abate) AS ate
FROM ind_abate_atak;

-- rollup confere com ATAK (~1.300-1.470 cab/mes)
SELECT * FROM v_ind_abate_diario ORDER BY data_abate DESC LIMIT 15;
```
