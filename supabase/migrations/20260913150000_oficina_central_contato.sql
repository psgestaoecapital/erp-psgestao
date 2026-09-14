-- ============================================================
-- Oficina · Onda 10 · Entrega C — Central de Mensagens (registro de contato)
-- ============================================================
-- O painel sem registro de contato vira lista que todo mundo ignora. A central transforma em processo:
-- quem foi chamado, por qual canal, e o desfecho. E quem RECUSA sai da fila (respeito + LGPD).
--
-- Depende de A (erp_clientes.aceita_pos_venda) e B (fn_oficina_pos_venda_fila). Merge em ordem A→B→C.

-- 1) Log de contato (novo — erp_contatos é AGENDA de contatos, não LOG de interação; não serve).
CREATE TABLE IF NOT EXISTS public.erp_oficina_contato (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  placa          text NOT NULL,
  cliente_id     uuid,
  os_id          uuid,
  tipo           text NOT NULL CHECK (tipo IN ('pos_venda','os_pronta','orcamento','garantia','outro')),
  canal          text NOT NULL CHECK (canal IN ('whatsapp','telefone','email','presencial')),
  mensagem       text,
  resultado      text CHECK (resultado IN ('enviado','respondeu','agendou','recusou','sem_resposta')),
  agendado_para  date,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_oficina_contato ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofic_contato_all ON public.erp_oficina_contato;
CREATE POLICY ofic_contato_all ON public.erp_oficina_contato FOR ALL
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
CREATE INDEX IF NOT EXISTS idx_ofic_contato_company_placa ON public.erp_oficina_contato (company_id, placa, criado_em DESC);

-- 2) Registrar um contato (ex.: ao abrir o wa.me, grava resultado='enviado'). Placa normalizada (bate com a fila).
CREATE OR REPLACE FUNCTION public.fn_oficina_contato_registrar(
  p_company_id uuid, p_placa text, p_tipo text DEFAULT 'pos_venda', p_canal text DEFAULT 'whatsapp',
  p_mensagem text DEFAULT NULL, p_cliente_id uuid DEFAULT NULL, p_os_id uuid DEFAULT NULL, p_resultado text DEFAULT 'enviado')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_placa text := upper(regexp_replace(coalesce(p_placa,''),'[^A-Za-z0-9]','','g'));
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_placa = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'placa_vazia'); END IF;
  INSERT INTO erp_oficina_contato (company_id, placa, cliente_id, os_id, tipo, canal, mensagem, resultado, criado_por)
    VALUES (p_company_id, v_placa, p_cliente_id, p_os_id, COALESCE(NULLIF(p_tipo,''),'pos_venda'),
            COALESCE(NULLIF(p_canal,''),'whatsapp'), NULLIF(btrim(p_mensagem),''),
            COALESCE(NULLIF(p_resultado,''),'enviado'), auth.uid())
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'contato_id', v_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_contato_registrar(uuid, text, text, text, text, uuid, uuid, text) TO authenticated;

-- 3) Marcar o desfecho. 'recusou' DESLIGA o opt-in de pós-venda (quem recusou não entra na fila de novo).
CREATE OR REPLACE FUNCTION public.fn_oficina_contato_desfecho(
  p_company_id uuid, p_contato_id uuid, p_resultado text, p_agendado_para date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cli uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_resultado NOT IN ('enviado','respondeu','agendou','recusou','sem_resposta') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resultado_invalido'); END IF;
  UPDATE erp_oficina_contato
     SET resultado = p_resultado,
         agendado_para = CASE WHEN p_resultado = 'agendou' THEN p_agendado_para ELSE agendado_para END
   WHERE id = p_contato_id AND company_id = p_company_id
   RETURNING cliente_id INTO v_cli;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'contato_nao_encontrado'); END IF;
  IF p_resultado = 'recusou' AND v_cli IS NOT NULL THEN
    UPDATE erp_clientes SET aceita_pos_venda = false, aceita_pos_venda_em = now(), updated_at = now()
     WHERE id = v_cli AND company_id = p_company_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'desligou_pos_venda', (p_resultado = 'recusou' AND v_cli IS NOT NULL));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_contato_desfecho(uuid, uuid, text, date) TO authenticated;

-- 4) Histórico de contatos de uma placa (aba "Contatos" no veículo). Evita ligar duas vezes na mesma semana.
CREATE OR REPLACE FUNCTION public.fn_oficina_veiculo_contatos(p_company_id uuid, p_placa text)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH norm AS (SELECT upper(regexp_replace(coalesce(p_placa,''),'[^A-Za-z0-9]','','g')) AS pn)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', k.id, 'tipo', k.tipo, 'canal', k.canal, 'mensagem', k.mensagem,
           'resultado', k.resultado, 'agendado_para', k.agendado_para, 'criado_em', k.criado_em)
         ORDER BY k.criado_em DESC), '[]'::jsonb)
  FROM erp_oficina_contato k, norm
  WHERE k.company_id = p_company_id AND k.placa = norm.pn AND norm.pn <> ''
    AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin());
$function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_veiculo_contatos(uuid, text) TO authenticated;

-- 5) Enriquecer a fila com contato_status + situacao 'contatado' (contato desde a última visita).
--    Muda a assinatura (nova coluna) → DROP + CREATE. Segue SEM valor (R4).
DROP FUNCTION IF EXISTS public.fn_oficina_pos_venda_fila(uuid, int);
CREATE OR REPLACE FUNCTION public.fn_oficina_pos_venda_fila(p_company_id uuid, p_janela_dias int DEFAULT NULL)
 RETURNS TABLE(
   placa text, veiculo text, cliente_nome text, cliente_id uuid,
   ultima_visita date, ultimo_km integer, visitas bigint, ultimo_servico text,
   dias_desde int, dias_faltantes int, tem_telefone boolean, aceita_pos_venda boolean,
   contato_status text, situacao text
 )
 LANGUAGE sql STABLE SET search_path TO 'public'
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
    (SELECT k.resultado FROM erp_oficina_contato k
       WHERE k.company_id = p_company_id AND k.placa = a.placa_norm AND k.criado_em::date >= a.ultima_visita
       ORDER BY k.criado_em DESC LIMIT 1) AS contato_status,
    CASE
      WHEN EXISTS (SELECT 1 FROM erp_oficina_contato k
                    WHERE k.company_id = p_company_id AND k.placa = a.placa_norm AND k.criado_em::date >= a.ultima_visita)
        THEN 'contatado'
      WHEN (j.dias - (current_date - a.ultima_visita)) <= 0 THEN 'a_contatar'
      ELSE 'aguardando'
    END AS situacao
  FROM agg a CROSS JOIN janela j
  ORDER BY dias_faltantes ASC, ultima_visita ASC;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_pos_venda_fila(uuid, int) TO authenticated;
