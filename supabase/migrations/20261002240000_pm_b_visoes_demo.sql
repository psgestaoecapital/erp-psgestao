-- PM-B · link da visão salva (CEO 02/10, visita à Pdois). A tela abre /dashboard/pm/pauta?visao=<id> já filtrada; o
-- banco não muda de estrutura (agency_visoes_pauta e a RLS da P1 já dizem quem vê: o dono e, se compartilhada, a equipe).
-- Esta migration só:
--   (1) fn_demo_seed_pm_visoes: 4 visões realistas na "Agência (P&M) - DEMO" (3 da equipe + 1 só do Gilberto), idempotente
--       por nome; recusa qualquer empresa que não seja a demo da P&M;
--   (2) encadeia (1) no fn_demo_reset da demo da P&M (RD-69) e roda uma vez agora;
--   (3) texto do "?" do link da visão.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_visoes(p_company_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: fn_demo_seed_pm_visoes — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_ceo  uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';
  v_cafe uuid; v_novas int := 0; r record;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_ceo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_dono');
  END IF;
  SELECT id INTO v_cafe FROM agency_clientes WHERE company_id = v_demo AND nome = 'Café Serra Azul' LIMIT 1;

  FOR r IN SELECT * FROM (VALUES
      (1, 'Atrasados da equipe',            true,  jsonb_build_object('atalho', 'atrasados')),
      (2, 'Esperando o cliente',            true,  jsonb_build_object('atalho', 'esperando_cliente')),
      (3, 'Café Serra Azul — tudo em aberto', true, CASE WHEN v_cafe IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('clientes', jsonb_build_array(v_cafe)) END),
      (4, 'Minha pauta',                    false, jsonb_build_object('atalho', 'meus'))
    ) v(ordem, nome, comp, filtros) ORDER BY ordem LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_visoes_pauta WHERE company_id = v_demo AND nome = r.nome AND excluido_em IS NULL) THEN
      INSERT INTO agency_visoes_pauta (company_id, dono_id, compartilhada, nome, filtros, ordem)
      VALUES (v_demo, v_ceo, r.comp, r.nome, r.filtros, r.ordem);
      v_novas := v_novas + 1;
    ELSE
      UPDATE agency_visoes_pauta SET filtros = r.filtros, compartilhada = r.comp, ordem = r.ordem
       WHERE company_id = v_demo AND nome = r.nome AND excluido_em IS NULL;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'visoes_novas', v_novas);
END $$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_visoes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_pm_visoes(uuid) TO service_role;

-- (2) o reset da demo da P&M re-arma as visões (patch por âncora, corpo vigente preservado)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_reset(uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_demo_seed_pm_visoes' THEN
    v_new := replace(v_def, E'  -- 28/09: a demo nunca fica sem plano',
      E'  -- 02/10 (PM-B): visões salvas da Pauta (link ?visao=)\n'
      || E'  IF p_company_id = ''b0700000-0000-4000-a000-000000000002''::uuid THEN\n'
      || E'    v_res := COALESCE(v_res, ''{}''::jsonb) || jsonb_build_object(''pauta_visoes'', public.fn_demo_seed_pm_visoes(p_company_id));\n'
      || E'  END IF;\n\n'
      || E'  -- 28/09: a demo nunca fica sem plano');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_reset: ancora 28/09 nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000002' AND is_demo IS TRUE) THEN
    RAISE NOTICE 'demo visões → %', public.fn_demo_seed_pm_visoes('b0700000-0000-4000-a000-000000000002');
  END IF;
END $$;

-- (3) "?" do link da visão
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'pm.pauta.visao_link', 'Visões', 'Link da visão',
       'Clique em "Copiar link" e mande pelo WhatsApp ou e-mail.',
       'Quem abre o link cai na Pauta já com o mesmo filtro — ideal para reunião de pauta e para o gestor cobrar a equipe.',
       'Mandar "Atrasados da equipe" no grupo da agência toda segunda às 9h.',
       'Mandar o link de uma visão "só sua": a outra pessoa não vê. Compartilhe com a equipe antes.',
       21, '/dashboard/pm/pauta', 'pm', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
