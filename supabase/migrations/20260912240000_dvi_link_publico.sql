-- ============================================================
-- Oficina Onda 2 · DVI — o link público de aprovação (o coração da onda)
-- ============================================================
-- O cliente abre /os/[token] sem login, vê o diagnóstico com semáforo (severidade já existe no dado),
-- fotos por item, e aprova item a item. A decisão grava com canal='link_publico'. Aprovação por
-- DVI+link converte muito mais que telefone (+50% de valor no setor).
--
-- Segurança (Pilar 2 / LGPD): token aleatório de 64 hex (nunca o id da OS); expira em 7 dias; revogável;
-- RLS LIGADA sem policy pública → a tabela NÃO é lida direto por anon; o acesso público é SÓ pelas RPCs
-- SECURITY DEFINER abaixo (o token é a chave). As RPCs devolvem só o necessário da OS (placa, itens,
-- fotos, valores, nome da oficina) — NUNCA CPF, telefone, endereço ou histórico de outras OS.

CREATE TABLE IF NOT EXISTS public.erp_os_link_publico (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  os_id        uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  expira_em    timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  aberto_em    timestamptz,
  aberto_count int NOT NULL DEFAULT 0,
  revogado     boolean NOT NULL DEFAULT false,
  criado_por   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_os_link_token ON public.erp_os_link_publico (token) WHERE NOT revogado;
CREATE INDEX IF NOT EXISTS idx_os_link_os ON public.erp_os_link_publico (os_id);
ALTER TABLE public.erp_os_link_publico ENABLE ROW LEVEL SECURITY;
-- sem policy: ninguém lê/escreve direto. Só as RPCs SECURITY DEFINER (o dono da fn ignora RLS).

-- ── gerar o link (interno; papel da oficina). Reusa link vivo se já existir (idempotente por OS). ──
CREATE OR REPLACE FUNCTION public.fn_os_link_publico_gerar(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_token text; v_exp timestamptz;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id=p_os_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa'); END IF;

  SELECT token, expira_em INTO v_token, v_exp FROM erp_os_link_publico
   WHERE os_id=p_os_id AND company_id=p_company_id AND NOT revogado AND expira_em > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'token', v_token, 'expira_em', v_exp, 'reusado', true); END IF;

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');  -- 64 hex
  INSERT INTO erp_os_link_publico (company_id, os_id, token, criado_por)
    VALUES (p_company_id, p_os_id, v_token, auth.uid())
  RETURNING expira_em INTO v_exp;
  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expira_em', v_exp, 'reusado', false);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_link_publico_gerar(uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_link_publico_gerar(uuid,uuid) TO authenticated, service_role;

-- ── obter (PÚBLICO, sem login): valida token, registra abertura, devolve só o necessário. ──
CREATE OR REPLACE FUNCTION public.fn_os_publico_obter(p_token text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lnk record; v_os record; v_itens jsonb; v_fotos jsonb; v_ofic text;
BEGIN
  SELECT * INTO v_lnk FROM erp_os_link_publico
   WHERE token = p_token AND NOT revogado AND expira_em > now() LIMIT 1;
  IF v_lnk.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido_ou_expirado'); END IF;

  UPDATE erp_os_link_publico SET aberto_em = coalesce(aberto_em, now()), aberto_count = aberto_count + 1
   WHERE id = v_lnk.id;

  SELECT numero, placa, marca, modelo, km INTO v_os FROM erp_os WHERE id = v_lnk.os_id;
  SELECT coalesce(razao_social, nome_fantasia, 'Oficina') INTO v_ofic FROM companies WHERE id = v_lnk.company_id;

  SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'tipo', i.tipo, 'descricao', i.descricao, 'severidade', i.severidade,
      'quantidade', i.quantidade, 'preco', i.preco, 'aprovado', i.aprovado)
      ORDER BY CASE i.severidade WHEN 'critico' THEN 0 WHEN 'recomendado' THEN 1 ELSE 2 END, i.ordem)
    INTO v_itens FROM erp_os_diagnostico_item i WHERE i.os_id = v_lnk.os_id;

  SELECT jsonb_agg(jsonb_build_object('item_id', f.diagnostico_item_id, 'foto_path', f.foto_path, 'anotacao', f.anotacao))
    INTO v_fotos FROM erp_os_registro_foto f WHERE f.os_id = v_lnk.os_id;

  RETURN jsonb_build_object('ok', true,
    'oficina', v_ofic,
    'os', jsonb_build_object('numero', v_os.numero, 'placa', v_os.placa, 'marca', v_os.marca, 'modelo', v_os.modelo, 'km', v_os.km),
    'itens', coalesce(v_itens, '[]'::jsonb),
    'fotos', coalesce(v_fotos, '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_publico_obter(text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_os_publico_obter(text) TO anon, authenticated, service_role;

-- ── aprovar (PÚBLICO): o cliente aprova item a item pelo link. Espelha fn_oficina_aprovacao_registrar. ──
CREATE OR REPLACE FUNCTION public.fn_os_publico_aprovar(p_token text, p_itens_aprovados uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lnk record; v_aprov int; v_total int; v_geral text; v_valor numeric;
BEGIN
  SELECT * INTO v_lnk FROM erp_os_link_publico
   WHERE token = p_token AND NOT revogado AND expira_em > now() LIMIT 1;
  IF v_lnk.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido_ou_expirado'); END IF;

  UPDATE erp_os_diagnostico_item
     SET aprovado = (id = ANY(coalesce(p_itens_aprovados, ARRAY[]::uuid[]))), aprovado_em = now()
   WHERE os_id = v_lnk.os_id AND company_id = v_lnk.company_id;

  SELECT count(*) FILTER (WHERE aprovado IS TRUE), count(*),
         coalesce(sum(coalesce(preco,0) * coalesce(quantidade,1)) FILTER (WHERE aprovado IS TRUE), 0)
    INTO v_aprov, v_total, v_valor
    FROM erp_os_diagnostico_item WHERE os_id = v_lnk.os_id AND company_id = v_lnk.company_id;

  v_geral := CASE WHEN v_aprov = 0 THEN 'recusado' WHEN v_aprov = v_total THEN 'aprovado' ELSE 'parcial' END;

  INSERT INTO erp_os_aprovacao (company_id, os_id, decisao, aprovador_nome, canal, observacao,
    itens_aprovados, itens_total, valor_total, criado_por)
  VALUES (v_lnk.company_id, v_lnk.os_id, v_geral, 'Cliente (link)', 'link_publico', NULL,
    v_aprov, v_total, v_valor, NULL);

  RETURN jsonb_build_object('ok', true, 'decisao', v_geral, 'itens_aprovados', v_aprov, 'itens_total', v_total, 'valor', v_valor);
END $function$;
REVOKE ALL ON FUNCTION public.fn_os_publico_aprovar(text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_os_publico_aprovar(text, uuid[]) TO anon, authenticated, service_role;
