-- Hub · FC (obras / cockpit / propostas / obras-resultado) — DELTA aud8 27/10 15:29 (Code: dev7claudeps)
-- (1) RD-98 pilar 3 (ORIGEM DO DADO): system_screens.views_consumidas / rpcs_chamadas estavam 0/0 nas 4 rotas.
--     Preenchido com o que o código de src/app/dashboard/projetos/{obras,cockpit,propostas,obras/resultado} realmente
--     consome (grep de .from()/.rpc(), RD-38 — provado no código, não suposto).
-- (2) RD-98 pilar 1 (DADO REAL): na Construtora DEMO (…0006) a Receita saía R$0 em todas as obras. v_obra_resultado soma
--     receita de MEDIÇÃO (erp_nfse_obra_medicao, exige NFS-e — barrada na DEMO por trg_bloqueia_emissao) OU de PEDIDO com
--     obra_id. Semeia 4 pedidos de material faturados (obra_id) na DEMO: Receita, CMV e margem saem do zero em
--     Resultado e Cockpit. NÃO toca NFS-e/fiscal; o "Faturado/Recebido" do card em /obras vem de NFS-e autorizada
--     (fn_obras_receita) e segue zero na DEMO por decisão fiscal — fica registrado como pendência.
-- ADITIVA: só metadados de system_screens + função de semente demo (só empresa …0006, is_demo, sem GRANT a usuário).
-- Idempotente (numero DEMO-RES-n). Plano de volta: DELETE dos pedidos numero LIKE 'DEMO-RES-%' e DROP da função.

UPDATE public.system_screens SET
  views_consumidas = ARRAY['v_obra_resultado','projetos_obras']::text[],
  rpcs_chamadas = ARRAY['fn_obras_listar','fn_obras_kpis','fn_obras_receita','fn_obra_escopo','fn_obra_item_adicionar',
    'fn_obra_item_excluir','fn_obra_mudar_status','fn_obra_fiscal_obter','fn_obra_salvar_fiscal']::text[],
  atualizado_em = now()
WHERE rota = '/dashboard/projetos/obras';

UPDATE public.system_screens SET
  views_consumidas = ARRAY['v_obra_resultado_alocado','projetos_obras']::text[],
  rpcs_chamadas = ARRAY[]::text[],
  atualizado_em = now()
WHERE rota = '/dashboard/projetos/cockpit';

UPDATE public.system_screens SET
  views_consumidas = ARRAY['erp_orcamentos','erp_orcamentos_itens','erp_crm_oportunidade','erp_crm_visita','erp_obra_planta',
    'projetos_modulo_config','projetos_obras']::text[],
  rpcs_chamadas = ARRAY[]::text[],
  atualizado_em = now()
WHERE rota = '/dashboard/projetos/propostas';

UPDATE public.system_screens SET
  views_consumidas = ARRAY['v_obra_resultado','v_obra_resultado_alocado']::text[],
  rpcs_chamadas = ARRAY['fn_obras_receita']::text[],
  atualizado_em = now()
WHERE rota = '/dashboard/projetos/obras/resultado';

-- ci-sem-guarda: fn_demo_seed_construtora_receita — só a empresa demo fixa do Hub (is_demo); sem GRANT a usuário
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_receita(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_n int := 0;
  r record;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;
  FOR r IN
    SELECT o.id AS obra_id, v.n, v.total, v.cmv
      FROM (VALUES (1,'Reforma loja%',48000::numeric,30000::numeric),
                   (2,'Piso e pintura%',36500,22000),
                   (3,'Piso industrial%',82000,51000),
                   (4,'Sala comercial%',25000,16000)) v(n,padrao,total,cmv)
      JOIN projetos_obras o ON o.company_id = c AND o.nome ILIKE v.padrao
  LOOP
    INSERT INTO erp_pedidos (company_id, numero, status, total, cmv, obra_id)
    SELECT c, 'DEMO-RES-' || r.n, 'faturado', r.total, r.cmv, r.obra_id
     WHERE NOT EXISTS (SELECT 1 FROM erp_pedidos WHERE company_id = c AND numero = 'DEMO-RES-' || r.n);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'obras_com_receita', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_receita(uuid) FROM PUBLIC, anon, authenticated;
