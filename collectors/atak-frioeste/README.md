# Coletor ATAK -> PS Gestao (Frioeste)

Roda DENTRO da rede Frioeste. Le o SQL Server ATAK (read-only) e empurra pro
Supabase via Edge Function `atak-ingest` (upsert idempotente).

Dois caminhos, **na mesma conexao** (o `.env` do abate ja serve p/ todos):
1. **Abate** (legado, INTOCADO): `dbo.tbRomaneioAbate` -> `ind_abate_atak` (colunas tipadas).
2. **Dominios genericos (CONFIG-DRIVEN, v3.0):** os dominios ATIVOS vem do MAPA na nuvem
   PS (`atak_fonte_mapa`, lido por `fn_atak_mapa_coletor`) -> `ind_atak_fato` (landing
   UNIVERSAL do F1). Manda o `raw` INTEIRO da linha; os campos tipados saem das VIEWS,
   ajustaveis sem recarregar. **Zero codigo novo por dominio depois** — so `INSERT`/ativar
   a linha no `atak_fonte_mapa` (a chave_fato e uma EXPRESSAO SQL computada no SQL Server;
   watermark auto-recuperavel pelo proprio landing → incremental; `REVISAR*`/NULL → FULL).
   Precisa de `SUPABASE_URL` + `SUPABASE_ANON_KEY` (publica) + `ATAK_COMPANY_ID` no `.env`.

> Embalagem (`dbo.tbProduto`) e estoque (`dbo.tbProdutoSaldoDiario`) estao no
> MESMO database ATAK do abate → **nenhuma credencial nova**: e so atualizar este
> `collector.js` na maquina Frioeste. (O `atak_conexao_config`/Vault do F1 e p/ o
> coletor config-driven multi-tenant — fase seguinte, nao e necessario aqui.)

## Instalacao (uma vez)
1. Node.js 18+ (precisa de `fetch` nativo).
2. Copiar a pasta `atak-frioeste` para a maquina.
3. `cd atak-frioeste && npm install`
4. `.env` com `INGEST_SECRET` + as `ATAK_SQL_*` (as MESMAS ja usadas pelo abate).

## Rodar
```
npm start
```

## Variaveis de ambiente
| Var | Default | Uso |
|---|---|---|
| `ATAK_SQL_SERVER/PORT/DATABASE/USER/PASSWORD` | — | conexao (as mesmas do abate) |
| `ATAK_FILIAL` | `100` | cod_filial |
| `ATAK_JANELA_DIAS` | `5` | janela do ABATE (por Data_abate) |
| `ATAK_DOMINIOS` | `embalagem,estoque` | dominios genericos a coletar |
| `ATAK_SKIP_ABATE` | (vazio) | setar p/ pular o abate |
| `ATAK_ESTOQUE_DATA_COL` | (vazio) | **recomendado**: coluna de data p/ janelar o estoque (249k) |
| `ATAK_ESTOQUE_JANELA_DIAS` | `7` | janela do estoque quando `ATAK_ESTOQUE_DATA_COL` setado |
| `ATAK_Q_EMBALAGEM` / `ATAK_Q_ESTOQUE` | — | sobrescreve a query (opcional) |
| `ATAK_CHAVE_EMBALAGEM` / `ATAK_CHAVE_ESTOQUE` | `cod_produto,...` | colunas candidatas p/ a chave_fato |
| `ATAK_DATA_ESTOQUE` | `data,...` | colunas candidatas p/ a data (chave do estoque) |

## ⚠️ Confirmar as colunas (SELECT TOP 5) antes da 1a carga
O `collector.js` manda o `raw` inteiro (nada se perde), mas a **chave_fato** precisa
de uma coluna estavel. Rode no SSMS (o Jian) e ajuste os envs `ATAK_CHAVE_*` /
`ATAK_DATA_ESTOQUE` / `ATAK_ESTOQUE_DATA_COL` conforme o nome REAL:
```sql
SELECT TOP 5 * FROM dbo.tbProduto;            -- confirmar a coluna do codigo do produto
SELECT TOP 5 * FROM dbo.tbProdutoSaldoDiario; -- confirmar codigo + coluna de data (p/ janela e chave)
```
Depois, se os campos tipados da view nao baterem com o `raw` real, **ajusta a
view** (`v_ind_embalagem`/`v_ind_estoque`) — nao precisa recarregar (resiliencia F1).

## Agendar (Windows Task Scheduler)
- Programa: `node` · Argumentos: `collector.js` · Iniciar em: `C:\...\atak-frioeste`
- Carregar o `.env` via um `.bat` (`cd` + `node collector.js`) ou wrapper `dotenv`.

## Como funciona
- Abate: janela movel de N dias por `Data_abate` (reprocessa correcoes de peso).
- Idempotente: `ind_abate_atak` dedup por (company,filial,chave_fato,seq_cabeca);
  `ind_atak_fato` dedup por (company,dominio,chave_fato). Re-rodar nunca duplica.
- Um dominio que falhar NAO derruba os outros (cada um em try/catch).

## Segredo do Edge (apos deploy)
```
supabase secrets set ATAK_INGEST_SECRET="<segredo-forte-aleatorio>" \
  --project-ref horsymhsinqcimflrtjo
```
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` ja existem no runtime.

## Auditoria (via MCP) pos-1a-rodada
```sql
-- abate (legado)
SELECT COUNT(*) cabecas, MIN(data_abate) de, MAX(data_abate) ate FROM ind_abate_atak;

-- dominios novos (landing universal)
SELECT dominio, COUNT(*) qtd, MAX(imported_at) ultimo FROM ind_atak_fato GROUP BY dominio;
SELECT * FROM v_ind_embalagem LIMIT 10;
SELECT * FROM v_ind_estoque LIMIT 10;
```
