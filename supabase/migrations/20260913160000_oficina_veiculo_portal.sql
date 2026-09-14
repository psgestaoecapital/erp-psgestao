-- ============================================================
-- Oficina · Onda 10 · Entrega D — Portal do Veículo (histórico público, SEM valores)
-- ============================================================
-- Espelha o mecanismo do /os/[token] (Onda 2): token opaco, signed URL server-side, página neutra,
-- noindex. Aqui o link é por PLACA (não por OS) e mostra o HISTÓRICO: visitas, datas, km, serviços, fotos.
--
-- 🔒 SEM VALORES (decisão do CEO 12/09): a RPC fn_veiculo_publico_obter NÃO devolve preço/valor/total
--    — não basta esconder na tela. Mesma regra do #1435/#1438 e do painel de pós-venda (R4).

-- 1) Link público por placa (espelha erp_os_link_publico). TTL do token: 180 dias (histórico que o cliente guarda).
CREATE TABLE IF NOT EXISTS public.erp_veiculo_link_publico (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  placa        text NOT NULL,                                   -- normalizada (upper, só alfanumérico)
  token        text NOT NULL UNIQUE,
  expira_em    timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  aberto_em    timestamptz,
  aberto_count int NOT NULL DEFAULT 0,
  revogado     boolean NOT NULL DEFAULT false,
  criado_por   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_veiculo_link_publico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofic_veic_link_all ON public.erp_veiculo_link_publico;
CREATE POLICY ofic_veic_link_all ON public.erp_veiculo_link_publico FOR ALL
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
CREATE INDEX IF NOT EXISTS idx_veic_link_company_placa ON public.erp_veiculo_link_publico (company_id, placa);

-- 2) Gerar (ou reusar) o link de uma placa. Não revela placa de outra empresa.
CREATE OR REPLACE FUNCTION public.fn_veiculo_link_publico_gerar(p_company_id uuid, p_placa text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_placa text := upper(regexp_replace(coalesce(p_placa,''),'[^A-Za-z0-9]','','g'));
        v_token text; v_exp timestamptz;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_placa = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'placa_vazia'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE company_id=p_company_id AND coalesce(excluida,false)=false
                  AND upper(regexp_replace(coalesce(placa,''),'[^A-Za-z0-9]','','g')) = v_placa) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;

  SELECT token, expira_em INTO v_token, v_exp FROM erp_veiculo_link_publico
   WHERE company_id=p_company_id AND placa=v_placa AND NOT revogado AND expira_em > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'token', v_token, 'expira_em', v_exp, 'reusado', true); END IF;

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');  -- 64 hex
  INSERT INTO erp_veiculo_link_publico (company_id, placa, token, criado_por)
    VALUES (p_company_id, v_placa, v_token, auth.uid())
  RETURNING expira_em INTO v_exp;
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expira_em', v_exp, 'reusado', false);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_veiculo_link_publico_gerar(uuid, text) TO authenticated;

-- 3) Obter o histórico público por token. SEM valores (nunca seleciona preco/valor/total).
--    Token inválido/expirado/revogado → ok=false (a página mostra tela neutra; nunca revela existência).
CREATE OR REPLACE FUNCTION public.fn_veiculo_publico_obter(p_token text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lnk record; v_ofic text; v_head record; v_visitas jsonb;
BEGIN
  SELECT * INTO v_lnk FROM erp_veiculo_link_publico
   WHERE token = p_token AND NOT revogado AND expira_em > now() LIMIT 1;
  IF v_lnk.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido_ou_expirado'); END IF;

  UPDATE erp_veiculo_link_publico SET aberto_em = coalesce(aberto_em, now()), aberto_count = aberto_count + 1
   WHERE id = v_lnk.id;

  SELECT coalesce(razao_social, nome_fantasia, 'Oficina') INTO v_ofic FROM companies WHERE id = v_lnk.company_id;

  SELECT o.placa, o.marca, o.modelo, o.ano, o.km
    INTO v_head FROM erp_os o
   WHERE o.company_id = v_lnk.company_id AND coalesce(o.excluida,false)=false
     AND upper(regexp_replace(coalesce(o.placa,''),'[^A-Za-z0-9]','','g')) = v_lnk.placa
   ORDER BY coalesce(o.data_abertura, o.created_at::date) DESC, o.created_at DESC LIMIT 1;

  SELECT jsonb_agg(v ORDER BY v.data DESC) INTO v_visitas FROM (
    SELECT
      coalesce(o.data_abertura, o.created_at::date) AS data,
      o.km AS km,
      (SELECT jsonb_agg(di.descricao ORDER BY di.ordem NULLS LAST, di.created_at)
         FROM erp_os_diagnostico_item di WHERE di.os_id = o.id AND NULLIF(btrim(di.descricao),'') IS NOT NULL) AS servicos,
      NULLIF(btrim(o.defeito_relatado),'') AS defeito,
      (SELECT jsonb_agg(jsonb_build_object('foto_path', rf.foto_path, 'anotacao', rf.anotacao))
         FROM erp_os_registro_foto rf WHERE rf.os_id = o.id) AS fotos
    FROM erp_os o
    WHERE o.company_id = v_lnk.company_id AND coalesce(o.excluida,false)=false
      AND upper(regexp_replace(coalesce(o.placa,''),'[^A-Za-z0-9]','','g')) = v_lnk.placa
  ) v;

  RETURN jsonb_build_object('ok', true,
    'oficina', v_ofic,
    'veiculo', jsonb_build_object('placa', v_head.placa, 'marca', v_head.marca, 'modelo', v_head.modelo,
                                  'ano', v_head.ano, 'ultimo_km', v_head.km),
    'visitas', coalesce(v_visitas, '[]'::jsonb));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_veiculo_publico_obter(text) TO anon, authenticated;

-- 4) Cadastrar a tela no catálogo (system_screens) — não nascer órfã (Hub V8). Rota pública por token:
--    NÃO auditável pelo robô (sem token válido só veria a página neutra); auditoria visual é prova pontual.
INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, rpcs_chamadas, auditavel_robo, motivo_nao_auditavel)
VALUES
  ('oficina_veiculo_portal', '/veiculo/[token]', 'oficina', 'Portal do Veículo (público)',
   'Portal público por token: histórico do veículo (visitas, datas, km, serviços, fotos) SEM valores (R4). Signed URL server-side, noindex, página neutra em token inválido.',
   'oficina_pos_venda', 'pronto', 'baixa',
   ARRAY['fn_veiculo_link_publico_gerar','fn_veiculo_publico_obter']::text[],
   false, 'Rota pública por token: o robô não tem token válido — só veria a página neutra. Auditoria visual é prova pontual do portal, não do conteúdo.')
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, estado_real = EXCLUDED.estado_real,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, auditavel_robo = EXCLUDED.auditavel_robo,
  motivo_nao_auditavel = EXCLUDED.motivo_nao_auditavel, atualizado_em = now();
