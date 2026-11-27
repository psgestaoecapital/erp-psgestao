-- Épico Logística V2 (FRIOESTE) · PR-2 · campos novos do veículo para o motor de custo da logística.
-- ADITIVO e idempotente: 3 colunas novas em erp_hub_frota_veiculo (nullable, sem default) + extensão do
-- INSERT/UPDATE de fn_hub_frota_veiculo_salvar para persistir os 3 campos (superset estrito: nada removido/alterado)
-- + 3 chaves de ajuda ("?") RD-95. Nenhum dado de cliente é apagado/alterado.
--   capacidade_kg  → capacidade de carga (obrigatória para ocupação e custo por t·km no BI de logística)
--   vida_util_anos → vida útil para a depreciação
--   valor_residual → valor residual (base da depreciação: (aquisição − residual) / vida útil)

ALTER TABLE public.erp_hub_frota_veiculo ADD COLUMN IF NOT EXISTS capacidade_kg numeric;
ALTER TABLE public.erp_hub_frota_veiculo ADD COLUMN IF NOT EXISTS vida_util_anos integer;
ALTER TABLE public.erp_hub_frota_veiculo ADD COLUMN IF NOT EXISTS valor_residual numeric;

-- Superset estrito de fn_hub_frota_veiculo_salvar: idêntica à viva, só acrescenta os 3 campos no INSERT e no UPDATE.
-- Guarda de empresa (fn__guarda_empresa), validação de placa, guarda de anexo, auditoria e assinatura INTACTAS.
CREATE OR REPLACE FUNCTION public.fn_hub_frota_veiculo_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_placa text; v_crlv text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_placa := upper(regexp_replace(coalesce(p_dados->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_placa) < 6 THEN RAISE EXCEPTION 'Informe a placa do veículo (ex.: ABC1D23 ou ABC1234).'; END IF;
  v_crlv := nullif(btrim(p_dados->>'crlv_path'), '');
  IF NOT public.fn__frota_anexo_ok(p_company_id, v_crlv) THEN RAISE EXCEPTION 'Anexo fora da pasta desta empresa.'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.erp_hub_frota_veiculo (company_id, placa, modelo, marca, ano, tipo, chassi, renavam, km_inicial, observacao,
                                              versao, cor, combustivel, cambio, potencia_cv, lugares, ncm, valor_aquisicao,
                                              data_entrada, fornecedor_nome, crlv_path, tem_manual, tem_chave_reserva,
                                              capacidade_kg, vida_util_anos, valor_residual)
    VALUES (p_company_id, v_placa,
            nullif(btrim(p_dados->>'modelo'), ''), nullif(btrim(p_dados->>'marca'), ''),
            nullif(p_dados->>'ano', '')::integer, coalesce(nullif(p_dados->>'tipo', ''), 'carro'),
            nullif(btrim(p_dados->>'chassi'), ''), nullif(btrim(p_dados->>'renavam'), ''),
            coalesce(nullif(p_dados->>'km_inicial', '')::numeric, 0), nullif(btrim(p_dados->>'observacao'), ''),
            nullif(btrim(p_dados->>'versao'), ''), nullif(btrim(p_dados->>'cor'), ''),
            nullif(btrim(p_dados->>'combustivel'), ''), nullif(btrim(p_dados->>'cambio'), ''),
            nullif(p_dados->>'potencia_cv', '')::integer, nullif(p_dados->>'lugares', '')::integer,
            nullif(btrim(p_dados->>'ncm'), ''), nullif(p_dados->>'valor_aquisicao', '')::numeric,
            nullif(p_dados->>'data_entrada', '')::date, nullif(btrim(p_dados->>'fornecedor_nome'), ''),
            v_crlv, coalesce((p_dados->>'tem_manual')::boolean, false), coalesce((p_dados->>'tem_chave_reserva')::boolean, false),
            nullif(p_dados->>'capacidade_kg', '')::numeric, nullif(p_dados->>'vida_util_anos', '')::integer,
            nullif(p_dados->>'valor_residual', '')::numeric)
    RETURNING id INTO v_id;
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (p_company_id, auth.uid(), 'erp_hub_frota_veiculo', v_id::text, 'criar', jsonb_build_object('placa', v_placa));
  ELSE
    UPDATE public.erp_hub_frota_veiculo SET
      placa = v_placa, modelo = nullif(btrim(p_dados->>'modelo'), ''), marca = nullif(btrim(p_dados->>'marca'), ''),
      ano = nullif(p_dados->>'ano', '')::integer, tipo = coalesce(nullif(p_dados->>'tipo', ''), tipo),
      chassi = nullif(btrim(p_dados->>'chassi'), ''), renavam = nullif(btrim(p_dados->>'renavam'), ''),
      km_inicial = coalesce(nullif(p_dados->>'km_inicial', '')::numeric, km_inicial),
      observacao = nullif(btrim(p_dados->>'observacao'), ''),
      versao = nullif(btrim(p_dados->>'versao'), ''), cor = nullif(btrim(p_dados->>'cor'), ''),
      combustivel = nullif(btrim(p_dados->>'combustivel'), ''), cambio = nullif(btrim(p_dados->>'cambio'), ''),
      potencia_cv = nullif(p_dados->>'potencia_cv', '')::integer, lugares = nullif(p_dados->>'lugares', '')::integer,
      ncm = nullif(btrim(p_dados->>'ncm'), ''), valor_aquisicao = nullif(p_dados->>'valor_aquisicao', '')::numeric,
      data_entrada = nullif(p_dados->>'data_entrada', '')::date, fornecedor_nome = nullif(btrim(p_dados->>'fornecedor_nome'), ''),
      crlv_path = coalesce(v_crlv, crlv_path),
      tem_manual = coalesce((p_dados->>'tem_manual')::boolean, tem_manual),
      tem_chave_reserva = coalesce((p_dados->>'tem_chave_reserva')::boolean, tem_chave_reserva),
      capacidade_kg = nullif(p_dados->>'capacidade_kg', '')::numeric,
      vida_util_anos = nullif(p_dados->>'vida_util_anos', '')::integer,
      valor_residual = nullif(p_dados->>'valor_residual', '')::numeric,
      atualizado_em = now()
     WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Veículo não encontrado (ou já excluído).'; END IF;
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (p_company_id, auth.uid(), 'erp_hub_frota_veiculo', v_id::text, 'editar', jsonb_build_object('placa', v_placa));
  END IF;
  RETURN v_id;
END
$function$;

-- Guarda da função (check-fn-guards · Regra 1): SECURITY DEFINER re-criada numa migration nova precisa reafirmar o
-- REVOKE anon no mesmo arquivo. Função guardada por empresa (fn__guarda_empresa) — nunca acessível a quem não está
-- logado. Idêntico aos grants vivos (authenticated/service_role); CREATE OR REPLACE preserva os demais.
REVOKE ALL ON FUNCTION public.fn_hub_frota_veiculo_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_veiculo_salvar(uuid, uuid, jsonb) TO authenticated;

-- Ajuda de campo ("?") RD-95 dos 3 campos novos. Aditivo e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.frota.capacidade_kg', '/dashboard/projetos/frota', 'Logística e custo', 'Capacidade de carga (kg)',
   'A carga máxima que o veículo transporta, em quilos (capacidade útil, não o peso do veículo).',
   'Permite medir a ocupação de cada carga (kg transportado ÷ capacidade) e distribuir o custo por quilo e por t·km no painel de logística.',
   'Caminhão baú de 12 toneladas: 12000.',
   'Confundir com o peso do veículo (tara) ou com o PBT: aqui é a capacidade de CARGA.', 'projetos', 850),
  ('projetos.frota.vida_util_anos', '/dashboard/projetos/frota', 'Logística e custo', 'Vida útil (anos)',
   'Por quantos anos se espera usar o veículo antes de trocá-lo (vida útil econômica).',
   'Entra no cálculo da depreciação mensal do veículo, que vira custo fixo rateado nas cargas.',
   'Caminhão: 10 anos.',
   'Deixar em branco quando quiser que a depreciação apareça: sem a vida útil o custo fixo de depreciação fica 0.', 'projetos', 851),
  ('projetos.frota.valor_residual', '/dashboard/projetos/frota', 'Logística e custo', 'Valor residual',
   'Quanto o veículo deve valer ao fim da vida útil (valor de revenda estimado).',
   'Base da depreciação: (valor de aquisição − valor residual) ÷ vida útil = quanto o veículo perde por ano, rateado como custo fixo.',
   'Caminhão comprado por R$ 300.000 com residual de R$ 60.000.',
   'Informar um valor maior que o de aquisição: o residual é sempre menor ou igual ao valor de compra.', 'projetos', 852)
ON CONFLICT (chave) DO NOTHING;
