-- SEED DEMO (RD-69/LGPD): ativo imobilizado da empresa "Comércio (GE) - DEMO"
-- (b0700000-0000-4000-a000-000000000004). Pedido do auditor_pdca_2 (10/11):
-- erp_bem estava com 0 linhas para QUALQUER empresa is_demo, então a tela de
-- Patrimônio aparecia vazia na DEMO e o aud8 ficava preso em 58/95; a jornada de
-- DEPRECIAÇÃO (fn_bem_calcular_depreciacao) não tinha o que depreciar.
--
-- Só dado de DEMONSTRAÇÃO, só empresa is_demo (sem dado de cliente real). Aditiva e
-- idempotente: UUIDs fixos + ON CONFLICT (id) DO NOTHING; datas relativas a
-- CURRENT_DATE para sempre gerar histórico de depreciação. Não altera nada de cliente.

DO $$
DECLARE
  v_co uuid := 'b0700000-0000-4000-a000-000000000004';  -- Comércio (GE) - DEMO
BEGIN
  -- segurança: só semeia se a empresa for mesmo de demonstração (nunca cliente real)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_co AND is_demo = true) THEN
    RAISE NOTICE 'Empresa % não é is_demo; seed de patrimônio ignorado.', v_co;
    RETURN;
  END IF;

  INSERT INTO erp_bem (id, company_id, codigo, descricao, natureza, data_aquisicao,
                       valor_aquisicao, fornecedor_nome, deprecia, vida_util_meses,
                       valor_residual, metodo_depreciacao, status, observacao)
  VALUES
    ('b0e70044-0000-4000-a000-000000000001', v_co, 'PATR-0001', 'Balcão frigorífico expositor', 'equipamento',
       (CURRENT_DATE - INTERVAL '24 months')::date, 18000.00, 'Refrigeração Sul Ltda', true, 120, 0, 'linear', 'ativo', 'Equipamento de loja (DEMO).'),
    ('b0e70044-0000-4000-a000-000000000002', v_co, 'PATR-0002', 'Veículo de entrega (utilitário)', 'veiculo',
       (CURRENT_DATE - INTERVAL '14 months')::date, 65000.00, 'Concessionária Modelo', true, 60, 5000.00, 'linear', 'ativo', 'Entregas da loja (DEMO).'),
    ('b0e70044-0000-4000-a000-000000000003', v_co, 'PATR-0003', 'Móveis e utensílios da loja', 'movel_utensilio',
       (CURRENT_DATE - INTERVAL '30 months')::date, 12000.00, 'Móveis Comercial', true, 120, 0, 'linear', 'ativo', 'Prateleiras, balcões, gôndolas (DEMO).'),
    ('b0e70044-0000-4000-a000-000000000004', v_co, 'PATR-0004', 'Computadores do caixa (PDV)', 'computador',
       (CURRENT_DATE - INTERVAL '8 months')::date, 9000.00, 'TechStore', true, 60, 0, 'linear', 'ativo', 'Estações de PDV (DEMO).'),
    ('b0e70044-0000-4000-a000-000000000005', v_co, 'PATR-0005', 'Instalação de ar-condicionado', 'instalacao',
       (CURRENT_DATE - INTERVAL '18 months')::date, 7000.00, 'Clima Service', true, 120, 0, 'linear', 'ativo', 'Climatização da loja (DEMO).'),
    ('b0e70044-0000-4000-a000-000000000006', v_co, 'PATR-0006', 'Terreno do galpão', 'terreno',
       (CURRENT_DATE - INTERVAL '36 months')::date, 150000.00, NULL, false, NULL, 0, 'linear', 'ativo', 'Terreno não deprecia (DEMO).')
  ON CONFLICT (id) DO NOTHING;

  -- Gera histórico de depreciação para as 3 últimas competências (mês atual inclusive),
  -- para os indicadores e a coluna de depreciação acumulada saírem do zero. Volume
  -- baixíssimo (6 bens x 3 meses); a função é idempotente (ON CONFLICT bem_id,competencia).
  PERFORM fn_bem_calcular_depreciacao(v_co, (date_trunc('month', CURRENT_DATE) - INTERVAL '2 months')::date);
  PERFORM fn_bem_calcular_depreciacao(v_co, (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date);
  PERFORM fn_bem_calcular_depreciacao(v_co, date_trunc('month', CURRENT_DATE)::date);
END $$;
