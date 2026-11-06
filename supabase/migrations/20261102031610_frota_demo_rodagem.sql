-- PDCA Hub · /dashboard/projetos/frota (Construtora Modelo - DEMO) — irriga rodagem do veículo DEM2B02 (RD-38).
-- A tela calcula Consumo (km/l) e Custo por km a partir das VIAGENS e ABASTECIMENTOS lançados
-- (fn_hub_frota_indicadores casa por placa: erp_viagem.km_inicial/km_final e erp_viagem_lancamento
-- tipo='abastecimento'). Prova no dado (BEGIN/ROLLBACK): DEM1A01 (288 km, 2 abast.) e DEM3C03 (320 km,
-- 2 abast.) JÁ têm rodagem; só o DEM2B02 (Saveiro) tinha 1 viagem SEM km e 0 abastecimento → Consumo e
-- Custo/km apareciam como "—" (o único que o auditor marcou). Esta migration ADITIVA lança 1 viagem com km
-- + 1 abastecimento SÓ para o DEM2B02, SOMENTE na empresa DEMO Construtora (b0700000-…-006), idempotente
-- (sentinela na carga). Não altera as viagens existentes, não toca dado de cliente, cálculo, guards ou financeiro.

DO $$
DECLARE
  v_co uuid := 'b0700000-0000-4000-a000-000000000006';
  v_placa text := 'DEM2B02';
  v_num int; v_vid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_co) THEN RETURN; END IF;
  -- idempotência: já lançada?
  IF EXISTS (SELECT 1 FROM erp_viagem WHERE company_id=v_co AND placa=v_placa AND carga='Rodagem DEMO (frota)') THEN RETURN; END IF;
  -- só se o veículo existe na frota DEMO
  IF NOT EXISTS (SELECT 1 FROM erp_hub_frota_veiculo WHERE company_id=v_co AND placa=v_placa AND excluido_em IS NULL) THEN RETURN; END IF;

  SELECT coalesce(max(numero),0)+1 INTO v_num FROM erp_viagem WHERE company_id=v_co;
  INSERT INTO erp_viagem (company_id,numero,colaborador_nome,periodo_inicio,periodo_fim,placa,km_inicial,km_final,status,carga,origem,destino,origem_registro)
    VALUES (v_co,v_num,'Motorista DEMO',CURRENT_DATE-10,CURRENT_DATE-9,v_placa,22100,22760,'aberta','Rodagem DEMO (frota)','Depósito','Obra Centro','administrativo')
    RETURNING id INTO v_vid;
  INSERT INTO erp_viagem_lancamento (company_id,viagem_id,tipo,data,fornecedor_nome,categoria,forma_pagamento,valor,placa,hodometro,litros,tipo_despesa,carga,origem_registro)
    VALUES (v_co,v_vid,'abastecimento',CURRENT_DATE-10,'Posto DEMO','combustivel','pix',357.00,v_placa,22760,55,'combustivel','Rodagem DEMO (frota)','administrativo');
END $$;
