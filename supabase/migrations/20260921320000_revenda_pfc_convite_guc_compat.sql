-- Revenda PF-c · compatibiliza o convite do contador (PF-b) com o TRIGGER de proteção deste PR.
--
-- Contexto (verdade no dado, RD-38): o PF-b (#1647) foi mergeado em produção SEM o set_config do GUC
-- (o fix ficou preso num branch já mergeado). Este PR (PF-c) instala o trigger trg_veic_perfil_fiscal_guard
-- que barra mudança de status/aprovação fora das RPCs oficiais. Sem este ajuste, assim que o trigger
-- entrar, o "enviar para aprovação" do contador (fn_veic_perfil_convite_enviar) quebraria — ele faz UPDATE
-- direto de status. Por isso o trigger e a compatibilidade do convite VIAJAM JUNTOS neste mesmo PR.
--
-- Redefine as duas funções do convite (idênticas às de produção) LIGANDO o GUC local
-- app.perfil_fiscal_transicao='on' antes da transição legítima do contador (guarda pelo token).
-- Aditivo/idempotente (CREATE OR REPLACE). Timestamp > 30000 (onde o convite nasceu) e > 29000 (trigger).

-- (3) Salvar (rascunho) via token — agora liga o GUC antes do UPDATE do perfil.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_salvar(p_token text, p_dados jsonb, p_operacoes jsonb DEFAULT NULL, p_ip text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c record; v_op jsonb;
BEGIN
  SELECT * INTO c FROM veic_perfil_convite WHERE token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex');
  IF NOT FOUND OR c.status <> 'ativo' OR c.expira_em <= now() THEN RETURN jsonb_build_object('ok', false, 'erro', 'token_invalido_ou_expirado'); END IF;
  UPDATE veic_perfil_convite SET acessos = acessos + 1, ip_ultimo_acesso = COALESCE(p_ip, ip_ultimo_acesso) WHERE id = c.id;

  -- transição legítima do contador (mantém 'rascunho') — libera o trigger de proteção do PF-c.
  PERFORM set_config('app.perfil_fiscal_transicao', 'on', true);
  UPDATE veic_perfil_fiscal SET
    status='rascunho', preenchido_por='contador',
    regime=p_dados->>'regime', anexo_faixa=p_dados->>'anexo_faixa',
    usa_trib_diferenca_pis_cofins=(p_dados->>'usa_trib_diferenca_pis_cofins')::boolean, usa_trib_diferenca_irpj_csll=(p_dados->>'usa_trib_diferenca_irpj_csll')::boolean,
    icms_saida_regra=p_dados->>'icms_saida_regra', icms_saida_pct=NULLIF(p_dados->>'icms_saida_pct','')::numeric, icms_saida_base_legal=p_dados->>'icms_saida_base_legal',
    nfe_entrada_pf=(p_dados->>'nfe_entrada_pf')::boolean, veicprod_obrigatorio_usado=(p_dados->>'veicprod_obrigatorio_usado')::boolean, troca_valor_base=p_dados->>'troca_valor_base',
    consignacao_documentos=p_dados->>'consignacao_documentos', garantia_provisao=(p_dados->>'garantia_provisao')::boolean, renave_aplica=(p_dados->>'renave_aplica')::boolean,
    reforma_tratamento=p_dados->>'reforma_tratamento', comissao_base=p_dados->>'comissao_base', encargos_pct=NULLIF(p_dados->>'encargos_pct','')::numeric,
    coaf_responsavel=p_dados->>'coaf_responsavel', coaf_limite_especie=NULLIF(p_dados->>'coaf_limite_especie','')::numeric,
    justificativas=COALESCE(p_dados->'justificativas', justificativas), observacao=p_dados->>'observacao', updated_at=now()
  WHERE id = c.perfil_id;

  IF p_operacoes IS NOT NULL AND jsonb_typeof(p_operacoes)='array' THEN
    DELETE FROM veic_perfil_fiscal_operacao WHERE perfil_id = c.perfil_id;
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_operacoes) LOOP
      IF COALESCE(v_op->>'operacao','') <> '' THEN
        INSERT INTO veic_perfil_fiscal_operacao (perfil_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, emite_nota_entrada, observacao)
        VALUES (c.perfil_id, c.company_id, v_op->>'operacao', v_op->>'cfop_dentro_uf', v_op->>'cfop_fora_uf', v_op->>'cst_ou_csosn', COALESCE((v_op->>'emite_nota_entrada')::boolean,false), v_op->>'observacao')
        ON CONFLICT (perfil_id, operacao) DO UPDATE SET cfop_dentro_uf=EXCLUDED.cfop_dentro_uf, cfop_fora_uf=EXCLUDED.cfop_fora_uf, cst_ou_csosn=EXCLUDED.cst_ou_csosn, emite_nota_entrada=EXCLUDED.emite_nota_entrada, observacao=EXCLUDED.observacao;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true, 'perfil_id', c.perfil_id);
END $function$;

-- (4) Enviar para aprovação via token — agora liga o GUC antes do UPDATE de status (rascunho→aguardando).
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_enviar(p_token text, p_ip text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM veic_perfil_convite WHERE token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex');
  IF NOT FOUND OR c.status <> 'ativo' OR c.expira_em <= now() THEN RETURN jsonb_build_object('ok', false, 'erro', 'token_invalido_ou_expirado'); END IF;
  -- transição legítima do contador (rascunho→aguardando) — libera o trigger de proteção do PF-c.
  PERFORM set_config('app.perfil_fiscal_transicao', 'on', true);
  UPDATE veic_perfil_fiscal SET status='aguardando_aprovacao', updated_at=now() WHERE id = c.perfil_id AND status='rascunho';
  UPDATE veic_perfil_convite SET status='usado', usado_em=now(), ip_ultimo_acesso=COALESCE(p_ip, ip_ultimo_acesso) WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'status', 'aguardando_aprovacao');
END $function$;
