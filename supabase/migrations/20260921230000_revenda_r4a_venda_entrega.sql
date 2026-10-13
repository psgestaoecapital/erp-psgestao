-- Revenda R4a · Venda e entrega (banco): checklist, termo, acerto de contas, devolução
--
-- Onda R4 (Tela 10). RDs 25·38·51·55·65·70. Regra de ouro: o financeiro é da GE — a revenda
-- DISPARA evento (marca título a estornar), NUNCA baixa/constrói conta em erp_receber.
-- Tudo idempotente e aditivo (RD-55); funções com guarda de empresa (get_user_company_ids OR is_admin),
-- sem acesso anônimo. Prova no dado em rollback (RD-38).

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Config por empresa (R4c edita isto): itens do checklist + texto padrão do termo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE veic_config ADD COLUMN IF NOT EXISTS checklist_entrega   jsonb;
ALTER TABLE veic_config ADD COLUMN IF NOT EXISTS termo_entrega_padrao text;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) veic_venda: KM na entrega, termo (texto + geração), aceite eletrônico simples, devolução.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS km_entrega        numeric;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS termo_md          text;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS termo_gerado_em   timestamptz;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS assinado_em       timestamptz;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS assinado_por_nome text;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS assinado_ip       text;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS devolvido_em      timestamptz;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS devolucao_motivo  text;
ALTER TABLE veic_venda ADD COLUMN IF NOT EXISTS devolvido_por     uuid;

-- Situação 'devolvida' entra no CHECK (aditivo, RD-55): venda entregue que foi devolvida.
ALTER TABLE veic_venda DROP CONSTRAINT IF EXISTS veic_venda_situacao_check;
ALTER TABLE veic_venda ADD CONSTRAINT veic_venda_situacao_check
  CHECK (situacao = ANY (ARRAY['aberta','faturada','entregue','cancelada','devolvida']));

-- 3) veic_venda_recebimento: flag de estorno = EVENTO para a GE (não baixa direta).
ALTER TABLE veic_venda_recebimento ADD COLUMN IF NOT EXISTS estorno_solicitado_em timestamptz;
ALTER TABLE veic_venda_recebimento ADD COLUMN IF NOT EXISTS estorno_motivo        text;
ALTER TABLE veic_venda_recebimento ADD COLUMN IF NOT EXISTS estorno_por           uuid;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Tabela do checklist de entrega (uma linha por item, por venda).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veic_venda_checklist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  venda_id    uuid NOT NULL REFERENCES veic_venda(id) ON DELETE CASCADE,
  item        text NOT NULL,
  obrigatorio boolean NOT NULL DEFAULT true,
  feito       boolean NOT NULL DEFAULT false,
  feito_em    timestamptz,
  feito_por   uuid,
  observacao  text,
  ordem       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_veic_venda_checklist_venda ON veic_venda_checklist(venda_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_venda_checklist_venda_item ON veic_venda_checklist(venda_id, item);

ALTER TABLE veic_venda_checklist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_venda_checklist'::regclass AND polname='veic_venda_checklist_rw') THEN
    CREATE POLICY veic_venda_checklist_rw ON veic_venda_checklist
      FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_venda_checklist TO authenticated;
GRANT ALL ON public.veic_venda_checklist TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) fn_veic_checklist_padrao(company): itens configurados na garagem OU o padrão de fábrica.
--    Nunca devolve vazio (roteiro 5: empresa sem config usa fábrica).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_checklist_padrao(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cfg jsonb; v_fabrica jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  v_fabrica := jsonb_build_array(
    jsonb_build_object('item','CRLV assinado','obrigatorio',true),
    jsonb_build_object('item','Comunicado de venda ao Detran','obrigatorio',true),
    jsonb_build_object('item','Chaves (informar quantas)','obrigatorio',true),
    jsonb_build_object('item','Manual do proprietário','obrigatorio',false),
    jsonb_build_object('item','Estepe e macaco','obrigatorio',true),
    jsonb_build_object('item','Laudo/vistoria','obrigatorio',true),
    jsonb_build_object('item','Manuais de garantia','obrigatorio',false),
    jsonb_build_object('item','Débitos quitados (IPVA/multas)','obrigatorio',true),
    jsonb_build_object('item','Limpeza','obrigatorio',false),
    jsonb_build_object('item','Combustível','obrigatorio',false)
  );
  SELECT checklist_entrega INTO v_cfg FROM veic_config WHERE company_id = p_company_id;
  IF v_cfg IS NULL OR jsonb_typeof(v_cfg) <> 'array' OR jsonb_array_length(v_cfg) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'fonte', 'fabrica', 'itens', v_fabrica);
  END IF;
  RETURN jsonb_build_object('ok', true, 'fonte', 'empresa', 'itens', v_cfg);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6) fn_veic_venda_checklist_materializar: cria as linhas do checklist para a venda (idempotente).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_venda_checklist_materializar(p_venda_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_pad jsonb; v_it jsonb; v_i int := 0; v_criou int := 0;
BEGIN
  SELECT company_id INTO v_comp FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_pad := fn_veic_checklist_padrao(v_comp);
  FOR v_it IN SELECT * FROM jsonb_array_elements(v_pad->'itens') LOOP
    v_i := v_i + 1;
    INSERT INTO veic_venda_checklist (company_id, venda_id, item, obrigatorio, ordem)
    VALUES (v_comp, p_venda_id, v_it->>'item', COALESCE((v_it->>'obrigatorio')::boolean, true), v_i)
    ON CONFLICT (venda_id, item) DO NOTHING;
    IF FOUND THEN v_criou := v_criou + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'criou', v_criou,
    'itens', (SELECT jsonb_agg(jsonb_build_object('id', id, 'item', item, 'obrigatorio', obrigatorio,
                'feito', feito, 'observacao', observacao) ORDER BY ordem)
              FROM veic_venda_checklist WHERE venda_id = p_venda_id));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 7) fn_veic_checklist_marcar: marca/desmarca um item (um toque na tela).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_checklist_marcar(p_item_id uuid, p_feito boolean, p_user uuid DEFAULT NULL, p_obs text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM veic_venda_checklist WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_venda_checklist SET
    feito = COALESCE(p_feito, feito),
    feito_em = CASE WHEN p_feito THEN now() ELSE NULL END,
    feito_por = CASE WHEN p_feito THEN p_user ELSE NULL END,
    observacao = COALESCE(p_obs, observacao)
  WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 8) fn_veic_venda_entregar ESTENDIDA: exige NF (trava R0.2, mantida) E checklist obrigatório completo.
--    Assinatura ganha p_km_entrega (aditivo). Materializa o checklist se ainda não existir
--    (roteiro 5: nunca entrega sem nenhum item).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_veic_venda_entregar(uuid, uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.fn_veic_venda_entregar(p_venda_id uuid, p_user uuid, p_obs text DEFAULT NULL::text, p_forcar boolean DEFAULT false, p_km_entrega numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_veic uuid; v_sit text; v_nfe uuid; v_nfe_status text;
  v_is_demo boolean; v_nf_ok boolean; v_entrega_demo boolean := false;
  v_faltando text[];
  v_ps_admin boolean := EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'));
BEGIN
  SELECT company_id, veiculo_id, situacao, nfe_id INTO v_comp, v_veic, v_sit, v_nfe
    FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_cancelada'); END IF;
  IF v_sit = 'devolvida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_devolvida'); END IF;

  SELECT status INTO v_nfe_status FROM erp_nfe_emitidas WHERE id = v_nfe;
  v_nf_ok := (v_nfe IS NOT NULL AND coalesce(v_nfe_status,'') = 'autorizada');
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = v_comp;

  -- Trava da NF (R0.2), inalterada.
  IF NOT v_nf_ok THEN
    IF coalesce(v_is_demo,false) AND v_sit = 'faturada' THEN
      v_entrega_demo := true;
      INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (v_comp, auth.uid(), 'veic_venda.entrega', p_venda_id::text, 'entrega_demo_sem_nota',
              jsonb_build_object('motivo', 'empresa de demonstração (is_demo) — sem NF-e real', 'situacao', v_sit));
    ELSIF v_ps_admin AND p_forcar AND coalesce(btrim(p_obs),'') <> '' THEN
      INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (v_comp, auth.uid(), 'veic_venda.entrega', p_venda_id::text, 'entrega_sem_nota_forcada',
              jsonb_build_object('justificativa', p_obs, 'nfe_status', v_nfe_status));
    ELSE
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_nota_autorizada',
        'mensagem', 'Emitir nota antes de entregar. A entrega exige NF-e autorizada'
          || CASE WHEN v_ps_admin THEN ' (ou liberação de PS_ADMIN com justificativa).' ELSE '.' END);
    END IF;
  END IF;

  -- R4a · Trava do CHECKLIST: materializa se ainda não há linhas e exige os obrigatórios marcados.
  IF NOT EXISTS (SELECT 1 FROM veic_venda_checklist WHERE venda_id = p_venda_id) THEN
    PERFORM fn_veic_venda_checklist_materializar(p_venda_id, p_user);
  END IF;
  SELECT array_agg(item ORDER BY ordem) INTO v_faltando
    FROM veic_venda_checklist WHERE venda_id = p_venda_id AND obrigatorio AND NOT feito;
  IF v_faltando IS NOT NULL AND array_length(v_faltando, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'checklist_incompleto',
      'faltando', to_jsonb(v_faltando),
      'mensagem', 'Marque os itens obrigatórios do checklist antes de concluir a entrega.');
  END IF;

  UPDATE veic_venda SET situacao = 'entregue',
         km_entrega = COALESCE(p_km_entrega, km_entrega)
   WHERE id = p_venda_id;
  PERFORM fn_veic_mudar_situacao(v_veic, 'entregue', p_user, COALESCE(p_obs, 'Veículo entregue'));
  RETURN jsonb_build_object('ok', true, 'situacao', 'entregue',
    'entrega_demo_sem_nota', v_entrega_demo,
    'forcado_sem_nota', (NOT v_nf_ok AND NOT v_entrega_demo));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 9) fn_veic_termo_entrega: gera o texto do termo, guarda em veic_venda.termo_md e devolve os dados.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_termo_entrega(p_venda_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_gar int; v_itens jsonb; v_md text; v_itens_txt text;
BEGIN
  SELECT s.id, s.company_id, s.veiculo_id, s.cliente_nome, s.cliente_doc, s.data_venda,
         s.valor_venda, s.valor_entrada, s.valor_financiado, s.banco_nome, s.km_entrega,
         s.vendedor_nome, s.situacao,
         vv.marca, vv.modelo, vv.ano_modelo, vv.cor, vv.placa, vv.chassi, vv.km_atual,
         c.nome_fantasia, c.razao_social
    INTO v
    FROM veic_venda s
    JOIN veic_veiculo vv ON vv.id = s.veiculo_id
    JOIN companies c ON c.id = s.company_id
   WHERE s.id = p_venda_id AND s.deleted_at IS NULL;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(garantia_prazo_meses, 0) INTO v_gar FROM veic_config WHERE company_id = v.company_id;

  SELECT jsonb_agg(jsonb_build_object('item', item, 'feito', feito, 'obrigatorio', obrigatorio,
           'observacao', observacao) ORDER BY ordem),
         string_agg((CASE WHEN feito THEN '[x] ' ELSE '[ ] ' END) || item
           || COALESCE(' — ' || observacao, ''), E'\n' ORDER BY ordem)
    INTO v_itens, v_itens_txt
    FROM veic_venda_checklist WHERE venda_id = p_venda_id;

  v_md :=
    '# Termo de entrega de veículo' || E'\n\n' ||
    '**Vendedor:** ' || COALESCE(v.nome_fantasia, v.razao_social, '') || E'\n' ||
    '**Comprador:** ' || COALESCE(v.cliente_nome, '—') || COALESCE(' (' || v.cliente_doc || ')', '') || E'\n' ||
    '**Data:** ' || to_char(COALESCE(v.data_venda, current_date), 'DD/MM/YYYY') || E'\n\n' ||
    '## Veículo' || E'\n' ||
    '- ' || COALESCE(v.marca,'') || ' ' || COALESCE(v.modelo,'') || COALESCE(' ' || v.ano_modelo::text, '') ||
      COALESCE(' · ' || v.cor, '') || E'\n' ||
    '- Placa: ' || COALESCE(v.placa,'—') || ' · Chassi: ' || COALESCE(v.chassi,'—') || E'\n' ||
    '- KM na entrega: ' || COALESCE(v.km_entrega::text, v.km_atual::text, '—') || E'\n\n' ||
    '## Itens conferidos na entrega' || E'\n' || COALESCE(v_itens_txt, '(sem checklist)') || E'\n\n' ||
    '## Valores' || E'\n' ||
    '- Valor da venda: R$ ' || to_char(COALESCE(v.valor_venda,0), 'FM999G999G990D00') || E'\n' ||
    '- Entrada: R$ ' || to_char(COALESCE(v.valor_entrada,0), 'FM999G999G990D00') || E'\n' ||
    '- Financiado: R$ ' || to_char(COALESCE(v.valor_financiado,0), 'FM999G999G990D00') ||
      COALESCE(' (' || v.banco_nome || ')', '') || E'\n\n' ||
    '## Garantia' || E'\n' ||
    CASE WHEN v_gar > 0 THEN '- Garantia contratada: ' || v_gar || ' meses a partir da entrega.'
         ELSE '- Sem garantia contratada (verificar condição legal aplicável).' END || E'\n\n' ||
    '_Declaro ter recebido o veículo nas condições acima._';

  UPDATE veic_venda SET termo_md = v_md, termo_gerado_em = now() WHERE id = p_venda_id;

  RETURN jsonb_build_object('ok', true, 'termo_md', v_md, 'gerado_em', now(),
    'garantia_meses', v_gar, 'itens', COALESCE(v_itens, '[]'::jsonb));
END $function$;

-- 9b) Aceite eletrônico simples (sem certificado — decisão futura).
CREATE OR REPLACE FUNCTION public.fn_veic_termo_assinar(p_venda_id uuid, p_nome text, p_ip text DEFAULT NULL, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_termo timestamptz;
BEGIN
  SELECT company_id, termo_gerado_em INTO v_comp, v_termo FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_termo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'termo_nao_gerado'); END IF;
  IF coalesce(btrim(p_nome),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;
  UPDATE veic_venda SET assinado_em = now(), assinado_por_nome = btrim(p_nome), assinado_ip = p_ip
   WHERE id = p_venda_id;
  RETURN jsonb_build_object('ok', true, 'assinado_em', now(), 'assinado_por_nome', btrim(p_nome));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 10) fn_veic_venda_acerto: previsto × realizado no fechamento, diferenças linha a linha + motivo.
--     Lê a GE (erp_receber) como fonte da verdade do realizado; NÃO a altera (RD-65 / regra de ouro).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_venda_acerto(p_venda_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_conta jsonb;
  v_preco numeric; v_custo_real numeric; v_lucro_proj numeric; v_encargos numeric;
  v_recebido numeric; v_aberto numeric; v_custos_pos numeric; v_lucro_real numeric;
  v_difs jsonb;
BEGIN
  SELECT s.id, s.company_id, s.veiculo_id, s.valor_venda, s.valor_entrada, s.retorno_banco, s.data_venda
    INTO v FROM veic_venda s WHERE s.id = p_venda_id AND s.deleted_at IS NULL;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_conta       := fn_veic_conta_do_carro(v.veiculo_id);      -- fonte única do custo real (RD-65)
  v_preco       := v.valor_venda;
  v_custo_real  := NULLIF(v_conta->>'custo_real_total','')::numeric;
  v_lucro_proj  := NULLIF(v_conta->>'lucro_real_projetado','')::numeric;
  v_encargos    := NULLIF(v_conta->>'encargos_pct','')::numeric;

  -- Realizado: recebido e em aberto vêm dos títulos da GE ligados aos recebimentos desta venda.
  SELECT
    COALESCE(sum(CASE WHEN er.status IN ('pago','parcial') THEN COALESCE(er.valor_pago,0) ELSE 0 END),0),
    COALESCE(sum(CASE WHEN er.status IN ('aberto','vencido','parcial')
                      THEN COALESCE(er.valor, r.valor) - COALESCE(er.valor_pago,0)
                      WHEN er.id IS NULL THEN COALESCE(r.valor,0)  -- recebimento sem título ainda gerado
                      ELSE 0 END),0)
    INTO v_recebido, v_aberto
    FROM veic_venda_recebimento r
    LEFT JOIN erp_receber er ON er.id = r.receber_id
   WHERE r.venda_id = p_venda_id;

  -- Custos lançados DEPOIS da venda (motivo clássico de divergência).
  SELECT COALESCE(sum(valor),0) INTO v_custos_pos
    FROM veic_custo WHERE veiculo_id = v.veiculo_id AND deleted_at IS NULL
      AND data_custo > v.data_venda;

  v_lucro_real := CASE WHEN v_custo_real IS NULL THEN NULL
                       ELSE round(v_recebido + COALESCE(v.retorno_banco,0) - v_custo_real - v_custos_pos, 2) END;

  v_difs := jsonb_build_array(
    jsonb_build_object('linha','Recebimento do negócio',
      'previsto', v_preco, 'realizado', round(v_recebido,2),
      'diferenca', round(COALESCE(v_preco,0) - v_recebido,2),
      'motivo', CASE WHEN v_aberto > 0 THEN 'título ainda aberto (R$ '||to_char(v_aberto,'FM999G999G990D00')||')'
                     ELSE 'sem divergência' END),
    jsonb_build_object('linha','Custo do veículo',
      'previsto', v_custo_real, 'realizado', round(COALESCE(v_custo_real,0) + v_custos_pos,2),
      'diferenca', round(v_custos_pos,2),
      'motivo', CASE WHEN v_custos_pos > 0 THEN 'custo lançado após a venda' ELSE 'sem divergência' END),
    jsonb_build_object('linha','Lucro',
      'previsto', v_lucro_proj, 'realizado', v_lucro_real,
      'diferenca', CASE WHEN v_lucro_proj IS NULL OR v_lucro_real IS NULL THEN NULL
                        ELSE round(v_lucro_real - v_lucro_proj,2) END,
      'motivo', 'reflete títulos em aberto e custos pós-venda')
  );

  RETURN jsonb_build_object('ok', true,
    'previsto', jsonb_build_object('preco_venda', v_preco, 'custo_real_total', v_custo_real,
       'encargos_pct', v_encargos, 'lucro_projetado', v_lucro_proj),
    'realizado', jsonb_build_object('recebido', round(v_recebido,2), 'em_aberto', round(v_aberto,2),
       'retorno_banco', v.retorno_banco, 'custos_pos_venda', round(v_custos_pos,2), 'lucro_real', v_lucro_real),
    'diferencas', v_difs);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 11) fn_veic_venda_devolver: venda ENTREGUE não se cancela — devolve-se. Estorno é EVENTO p/ GE.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_venda_devolver(p_venda_id uuid, p_motivo text, p_data date DEFAULT NULL, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text; v_titulos uuid[]; v_data date;
BEGIN
  SELECT company_id, veiculo_id, situacao INTO v_comp, v_veic, v_sit
    FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit <> 'entregue' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_venda_entregue',
      'mensagem', 'A devolução só se aplica a venda entregue. Venda não entregue usa o cancelamento.'); END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;

  v_data := COALESCE(p_data, current_date);

  UPDATE veic_venda SET situacao = 'devolvida', devolvido_em = now(),
         devolucao_motivo = p_motivo, devolvido_por = p_user,
         observacao = COALESCE(observacao,'') || ' | DEVOLVIDA ' || to_char(v_data,'DD/MM/YYYY') || ': ' || p_motivo
   WHERE id = p_venda_id;

  -- veículo volta ao pátio como 'devolvido'
  PERFORM fn_veic_mudar_situacao(v_veic, 'devolvido', p_user, 'Venda devolvida: ' || p_motivo);

  -- EVENTO p/ GE: marca os títulos a estornar. NÃO baixa erp_receber (regra de ouro).
  UPDATE veic_venda_recebimento
     SET estorno_solicitado_em = now(), estorno_motivo = p_motivo, estorno_por = p_user
   WHERE venda_id = p_venda_id AND receber_id IS NOT NULL AND estorno_solicitado_em IS NULL;

  SELECT array_agg(receber_id) INTO v_titulos
    FROM veic_venda_recebimento WHERE venda_id = p_venda_id AND receber_id IS NOT NULL;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v_comp, auth.uid(), 'veic_venda.devolucao', p_venda_id::text, 'venda_devolvida',
          jsonb_build_object('motivo', p_motivo, 'data', v_data,
            'titulos_a_estornar', to_jsonb(COALESCE(v_titulos, ARRAY[]::uuid[]))));

  RETURN jsonb_build_object('ok', true, 'situacao', 'devolvida',
    'veiculo_situacao', 'devolvido',
    'titulos_a_estornar', to_jsonb(COALESCE(v_titulos, ARRAY[]::uuid[])),
    'aviso_ge', 'Títulos marcados a estornar (evento). A baixa/estorno é da GE.');
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 12) fn_veic_venda_cancelar: bloqueia cancelar quando ENTREGUE (usar devolução).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_venda_cancelar(p_venda_id uuid, p_user uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text; v_veic_sit text; n_titulos int; v_troca uuid;
BEGIN
  SELECT company_id, veiculo_id, situacao INTO v_comp, v_veic, v_sit FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_cancelada'); END IF;
  -- R4a: venda entregue não se cancela — devolve-se (fecha o buraco do auditor).
  IF v_sit = 'entregue' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'venda_entregue_use_devolucao',
      'mensagem', 'Venda já entregue: registre uma DEVOLUÇÃO (com motivo), não um cancelamento.'); END IF;

  SELECT count(*) INTO n_titulos FROM veic_venda_recebimento WHERE venda_id = p_venda_id AND receber_id IS NOT NULL;
  UPDATE veic_venda SET situacao = 'cancelada', observacao = COALESCE(observacao,'') || ' | CANCELADA: ' || COALESCE(p_motivo,'') WHERE id = p_venda_id;

  SELECT situacao INTO v_veic_sit FROM veic_veiculo WHERE id = v_veic;
  IF v_veic_sit IN ('vendido','entregue') THEN
    PERFORM fn_veic_mudar_situacao(v_veic, 'disponivel', p_user, 'Venda cancelada' || COALESCE(': '||p_motivo,''));
  END IF;
  SELECT veiculo_id INTO v_troca FROM veic_proposta_troca t
    JOIN veic_venda vd ON vd.proposta_id = t.proposta_id WHERE vd.id = p_venda_id AND t.veiculo_id IS NOT NULL LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'titulos_nao_excluidos', n_titulos, 'troca_veiculo_id', v_troca);
END $function$;
