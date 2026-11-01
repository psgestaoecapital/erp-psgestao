-- Contrato de preços + medição · perfil CONSULTA (viewer) só lê — auditor_pdca_g 24/10 (login real) · desenvolvedor_6_g (faixa 54).
-- O viewer via Arquivar/Editar/Salvar medição e a gravação passava (as fn_tabela_preco_* e fn_medicao_cliente_* só checam a
-- empresa). A trava fica NO BANCO, num gatilho BEFORE INSERT/UPDATE/DELETE nas 6 tabelas do contrato e da medição: vale para
-- toda função de gravação (atual ou futura) sem reescrever nenhuma. A tela usa a mesma função para esconder as ações.
-- ADITIVA: só função NOVA + gatilhos NOVOS + textos NOVOS de "?" (RD-95). Nenhuma função, view ou policy existente muda.
-- Conexão de serviço (auth.uid() nulo) e admin não são barrados.

CREATE OR REPLACE FUNCTION public.fn_tabela_preco_pode_gravar(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM public.user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND lower(COALESCE(uc.role, '')) NOT IN ('viewer', 'visualizador'))
$function$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_pode_gravar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_pode_gravar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn__tabela_preco_trava_viewer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF NOT public.fn_tabela_preco_pode_gravar(v_company) THEN
    RAISE EXCEPTION 'Seu perfil é de consulta: você pode ver o contrato e as medições, mas não editar, arquivar ou salvar. Peça ao administrativo.'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

REVOKE ALL ON FUNCTION public.fn__tabela_preco_trava_viewer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_tabela_preco_cliente;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_tabela_preco_cliente
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();
DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_tabela_preco_item;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_tabela_preco_item
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();
DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_tabela_preco_condicao;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_tabela_preco_condicao
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();
DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_tabela_preco_codigo;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_tabela_preco_codigo
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();
DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_medicao_cliente;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_medicao_cliente
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();
DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_medicao_cliente_item;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_medicao_cliente_item
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();

-- "?" (RD-95) do aviso de perfil de consulta.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('hub.tabela_preco.perfil_consulta', 'Tela', 'Perfil de consulta', 'Calculado: aparece quando o seu acesso a esta empresa é só de consulta.',
        'Você vê o contrato, calcula preços e abre as medições salvas, mas Editar, Arquivar e Salvar medição ficam escondidos e o banco recusa a gravação.',
        'Perfil de consulta: peça ao administrativo para editar o contrato.', 'Achar que a tela está com defeito: o botão some de propósito para o perfil de consulta.', 60,
        '/dashboard/projetos/tabelas-preco', 'hub_construcao', 'publicado')
ON CONFLICT (chave) DO NOTHING;
