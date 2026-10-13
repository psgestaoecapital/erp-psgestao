-- ATAK · associar atak_fonte_mapa à Frioeste (resolve sem_config)
--
-- Diagnóstico (RD-38, ao vivo 17/08): o agente na SERVERFRIOESTE sobe e manda heartbeat
-- (erp_agente_status: status 'sem_config'), mas não coleta — ind_atak_fato travado em 274.579.
-- Causa: os 17 registros de atak_fonte_mapa (o mapa de quais fontes/domínios coletar) estavam
-- com company_id = NULL. O agente reporta company_id 975365cc-... , pede o mapa dessa empresa e
-- não acha nada → sem_config.
--
-- Seguro: só há 1 frigorífico ATAK no sistema (atak_conexao_config: 1 linha, 975365cc, ativo) e
-- nenhuma outra empresa tem entradas no mapa — logo os 17 NULL são o mapa completo da Frioeste.
-- Backup + guarda de contagem conforme RD-54/55.

-- 1) Backup (RD-54) — preserva o estado original antes do backfill.
CREATE TABLE IF NOT EXISTS bkp.atak_fonte_mapa_20260817 AS
  SELECT * FROM atak_fonte_mapa;

-- 2) Associar à Frioeste (o único frigorífico ATAK ativo).
UPDATE atak_fonte_mapa
SET company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
WHERE company_id IS NULL;

-- 3) Guarda (RD-55): falha o deploy se sobrou algum company_id NULL.
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM atak_fonte_mapa WHERE company_id IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'atak_fonte_mapa ainda tem % registro(s) com company_id NULL após o backfill', n;
  END IF;
END $$;
