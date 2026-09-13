-- ============================================================
-- Oficina · Onda 10 · Entrega B — painel de pós-venda com CONTAGEM REGRESSIVA
-- ============================================================
-- A KGF é nova: hoje NENHUMA placa passou dos 90 dias (a mais antiga tem 47). Uma lista de "vencidos"
-- sairia vazia. Por isso o desenho é CONTAGEM REGRESSIVA: o painel mostra quantos dias FALTAM para cada
-- veículo entrar no pós-venda. Serve desde o 1º dia (mostra a fila se formando) e no dia 90 já tem gente.
--
-- 🔒 R4 (regra 655bb74b): esta RPC NÃO devolve valor nenhum — sem ticket, sem faturamento, sem potencial.
--    Contagem e placa são operação; dinheiro é só dono/admin. Aqui NÃO entra R$ (nem escondido no payload).
--
-- Depende da Entrega A (erp_clientes.aceita_pos_venda) — merge em ordem A→B. situacao aqui é só
-- aguardando/a_contatar (por dias); o contato registrado (contatado/retornou) entra na Entrega C.

-- 1) Janela configurável pela oficina (o Gean ajusta). Default 90.
ALTER TABLE public.erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS pos_venda_janela_dias int NOT NULL DEFAULT 90;

COMMENT ON COLUMN public.erp_oficina_parametros.pos_venda_janela_dias IS
  'Onda 10: dias após a última visita para o veículo entrar na fila de pós-venda. Default 90. Ajustável.';

-- 2) A fila. RETURNS TABLE (o CEO confere com SELECT *). Ordenada por quem entra primeiro (dias_faltantes).
CREATE OR REPLACE FUNCTION public.fn_oficina_pos_venda_fila(p_company_id uuid, p_janela_dias int DEFAULT NULL)
 RETURNS TABLE(
   placa text, veiculo text, cliente_nome text, cliente_id uuid,
   ultima_visita date, ultimo_km integer, visitas bigint, ultimo_servico text,
   dias_desde int, dias_faltantes int, tem_telefone boolean, aceita_pos_venda boolean, situacao text
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH janela AS (
    SELECT COALESCE(p_janela_dias,
             (SELECT pos_venda_janela_dias FROM erp_oficina_parametros WHERE company_id = p_company_id),
             90)::int AS dias
  ),
  base AS (
    SELECT upper(regexp_replace(coalesce(o.placa,''),'[^A-Za-z0-9]','','g')) AS placa_norm, o.*
      FROM erp_os o
      WHERE o.company_id = p_company_id AND coalesce(o.excluida,false) = false
        AND coalesce(o.placa,'') <> ''
        AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  ),
  agg AS (
    SELECT placa_norm,
           (array_agg(placa       ORDER BY created_at DESC))[1] AS placa,
           (array_agg(cliente_nome ORDER BY created_at DESC))[1] AS cliente_nome,
           (array_agg(cliente_id   ORDER BY created_at DESC))[1] AS cliente_id,
           (array_agg(marca        ORDER BY created_at DESC))[1] AS marca,
           (array_agg(modelo       ORDER BY created_at DESC))[1] AS modelo,
           (array_agg(km           ORDER BY created_at DESC))[1] AS ultimo_km,
           (array_agg(id ORDER BY coalesce(data_abertura, created_at::date) DESC, created_at DESC))[1] AS ultima_os_id,
           count(*) AS visitas,
           max(coalesce(data_abertura, created_at::date)) AS ultima_visita
      FROM base GROUP BY placa_norm
  )
  SELECT
    a.placa,
    NULLIF(btrim(concat_ws(' ', a.marca, a.modelo)), '') AS veiculo,
    a.cliente_nome,
    a.cliente_id,
    a.ultima_visita,
    a.ultimo_km,
    a.visitas,
    COALESCE(
      (SELECT NULLIF(btrim(di.descricao),'') FROM erp_os_diagnostico_item di
        WHERE di.os_id = a.ultima_os_id ORDER BY di.ordem NULLS LAST, di.created_at LIMIT 1),
      (SELECT NULLIF(btrim(o2.diagnostico),'')       FROM erp_os o2 WHERE o2.id = a.ultima_os_id),
      (SELECT NULLIF(btrim(o2.descricao_servico),'') FROM erp_os o2 WHERE o2.id = a.ultima_os_id),
      (SELECT NULLIF(btrim(o2.defeito_relatado),'')  FROM erp_os o2 WHERE o2.id = a.ultima_os_id)
    ) AS ultimo_servico,
    (current_date - a.ultima_visita)::int AS dias_desde,
    (j.dias - (current_date - a.ultima_visita))::int AS dias_faltantes,
    (SELECT COALESCE(NULLIF(btrim(c.whatsapp),''), NULLIF(btrim(c.celular),''), NULLIF(btrim(c.telefone),'')) IS NOT NULL
       FROM erp_clientes c WHERE c.id = a.cliente_id) AS tem_telefone,
    (SELECT c.aceita_pos_venda FROM erp_clientes c WHERE c.id = a.cliente_id) AS aceita_pos_venda,
    CASE WHEN (j.dias - (current_date - a.ultima_visita)) <= 0 THEN 'a_contatar' ELSE 'aguardando' END AS situacao
  FROM agg a CROSS JOIN janela j
  ORDER BY dias_faltantes ASC, ultima_visita ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_pos_venda_fila(uuid, int) TO authenticated;

-- 3) Ajustar a janela (o Gean = OFICINA_DONO ajusta; é parâmetro OPERACIONAL, não dinheiro → permite o dono da oficina).
CREATE OR REPLACE FUNCTION public.fn_oficina_pos_venda_janela_set(p_company_id uuid, p_dias int)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT (is_admin() OR public.fn_oficina_papel(p_company_id) IN ('CLIENT_OWNER','OFICINA_DONO')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao',
      'mensagem', 'Só o dono ajusta a janela do pós-venda.'); END IF;
  IF p_dias IS NULL OR p_dias < 15 OR p_dias > 365 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fora_do_intervalo',
      'mensagem', 'Escolha entre 15 e 365 dias.'); END IF;
  INSERT INTO erp_oficina_parametros (company_id, pos_venda_janela_dias)
    VALUES (p_company_id, p_dias)
    ON CONFLICT (company_id) DO UPDATE SET pos_venda_janela_dias = EXCLUDED.pos_venda_janela_dias, alterado_em = now();
  RETURN jsonb_build_object('ok', true, 'janela_dias', p_dias);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_pos_venda_janela_set(uuid, int) TO authenticated;

-- 4) Registrar a tela no catálogo (o hub da Oficina lê de module_catalog via fn_modulos_sidebar_por_area)
--    e liberá-la nos planos de oficina (mesmos de Veículos/Entregues). Ramo automotiva (pós-venda por placa).
INSERT INTO public.module_catalog
  (id, nome, grupo, rota, icone, ordem, ativo, layer, is_shared, subgrupo, diferencial, ramos_aplicaveis, vertical_specific, surface_in_groups, dependencies, legacy, rbac_isento)
VALUES
  ('oficina_pos_venda', 'Pós-venda', 'oficina', '/dashboard/oficina/pos-venda', '🔔', 21, true, '2_svc', false,
   'oficina_operacao', false, ARRAY['automotiva']::text[], ARRAY['oficina']::text[], ARRAY[]::text[], ARRAY[]::text[], false, false)
ON CONFLICT (id) DO UPDATE SET
  nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, rota=EXCLUDED.rota, ativo=true, legacy=false,
  subgrupo=EXCLUDED.subgrupo, ordem=EXCLUDED.ordem, ramos_aplicaveis=EXCLUDED.ramos_aplicaveis,
  vertical_specific=EXCLUDED.vertical_specific;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT p, 'oficina_pos_venda', true, 'basic', false
  FROM unnest(ARRAY['v15_oficina_grande','v15_oficina_media','v15_oficina_pequena']) AS p
ON CONFLICT (plan_id, module_id) DO NOTHING;
