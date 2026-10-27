-- Hub · /dashboard/projetos/insumos — delta até 95 (aud8/Max 27/10, caixa 726e1f34 · Code: desenvolvedor_4_g)
-- Foto DEMO 0006 12:43Z: nota 70 (subiu de 55). Gaps provados no dado (RD-38):
--   #1 (CRÍTICO) "ESTOQUE (GE): sem ligação" em TODOS os insumos — DEMO 0006 tem 0 vínculos em hub_insumo_produto,
--       mesmo havendo 20 produtos no estoque do GE. Semeia a ligação real de 6 insumos a produtos do estoque (custo
--       real por produto, não genérico), alguns com custo divergente do catálogo para a tela mostrar a divergência.
--   #4 (RD-98 p4) "Excluir insumo" fazia DELETE FÍSICO e, pior, INSERT em audit_log_global com colunas INEXISTENTES
--       (operacao/dados_anteriores/executado_em/executado_por) — toda exclusão QUEBRAVA (erro de coluna). Vira exclusão
--       RASTREÁVEL: colunas aditivas deleted_at/deleted_by + RPC guardada (autor/quando + audit_log com as colunas
--       REAIS) e função de restaurar; nunca mais DELETE físico. A listagem passa a filtrar deleted_at.
--   #5 (RD-98 p3) a rota estava sem system_screens.views_consumidas/rpcs_chamadas (vazios) — preenche a origem do dado.
-- Gaps #2 (EM USO) e #3 (RD-95 "?") JÁ atendidos no dado/código (RD-38): a view v_projetos_insumos_ui já conta
--   qtd_servicos_uso real (1–3 por insumo no DEMO 0006, 24 linhas de BOM apontam para os 17 insumos próprios) e todas as
--   colunas/filtros já têm "?" (CatalogoTable renderiza col.ajuda; chaves presentes em erp_ajuda_campo). Sem mudança.
--
-- SENSÍVEL (RD-94.1): CREATE OR REPLACE de função e view existentes — segue a via do Hub (label hub). Aditivo em
--   m16_insumos (cadastro próprio da vertical Projetos; não é núcleo compartilhado), sem tocar RLS/policies.

-- 1) Colunas aditivas de exclusão rastreável
ALTER TABLE public.m16_insumos
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  uuid;

-- 2) Exclusão rastreável do insumo (soft-delete: deleted_at + autor/quando + audit; nunca DELETE físico).
--    Corrige o INSERT quebrado (colunas reais de audit_log_global) e adiciona a guarda de empresa que faltava.
CREATE OR REPLACE FUNCTION public.fn_projetos_deletar_insumo(p_insumo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_insumo record;
  v_em_uso int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entre no sistema para excluir');
  END IF;

  SELECT * INTO v_insumo FROM m16_insumos WHERE id = p_insumo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insumo nao encontrado');
  END IF;
  IF v_insumo.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insumo ja excluido');
  END IF;
  IF v_insumo.is_publico THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nao eh permitido excluir insumos publicos');
  END IF;
  -- Guarda de empresa (a versao anterior era SECURITY DEFINER sem checar a empresa do chamador).
  IF v_insumo.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_acesso');
  END IF;

  -- Em uso por serviços (BOM) → não exclui; oriente a desvincular/desativar.
  SELECT count(DISTINCT servico_id) INTO v_em_uso
  FROM projetos_servicos_bom WHERE insumo_id = p_insumo_id;
  IF v_em_uso > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Insumo em uso por %s servico(s). Remova-o do BOM primeiro ou marque como Inativo em vez de excluir.', v_em_uso),
      'qtd_servicos_uso', v_em_uso
    );
  END IF;

  UPDATE m16_insumos
     SET deleted_at = now(), deleted_by = auth.uid(), status = 'inativo', updated_at = now()
   WHERE id = p_insumo_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_insumo.company_id, auth.uid(), 'm16_insumos', p_insumo_id, 'excluir',
            jsonb_build_object('name', v_insumo.name, 'status', v_insumo.status, 'deleted_at', NULL),
            jsonb_build_object('name', v_insumo.name, 'status', 'inativo', 'deleted_at', now()));

  RETURN jsonb_build_object('success', true, 'deletado', v_insumo.name);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_deletar_insumo(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_projetos_deletar_insumo(uuid) TO authenticated;

-- 3) Restaurar insumo excluído (reversível e auditado) — RD-98 p4.
CREATE OR REPLACE FUNCTION public.fn_projetos_restaurar_insumo(p_insumo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_insumo record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entre no sistema para restaurar');
  END IF;
  SELECT * INTO v_insumo FROM m16_insumos WHERE id = p_insumo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insumo nao encontrado');
  END IF;
  IF v_insumo.deleted_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insumo nao esta excluido');
  END IF;
  IF v_insumo.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'sem_acesso');
  END IF;

  UPDATE m16_insumos
     SET deleted_at = NULL, deleted_by = NULL, status = 'ativo', updated_at = now()
   WHERE id = p_insumo_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_insumo.company_id, auth.uid(), 'm16_insumos', p_insumo_id, 'restaurar',
            jsonb_build_object('status', 'inativo', 'deleted_at', v_insumo.deleted_at),
            jsonb_build_object('status', 'ativo', 'deleted_at', NULL));

  RETURN jsonb_build_object('success', true, 'restaurado', v_insumo.name);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_restaurar_insumo(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_projetos_restaurar_insumo(uuid) TO authenticated;

-- 4) View: expõe deleted_at/deleted_by (a listagem filtra deleted_at IS NULL; a aba "Excluídos" mostra os excluídos).
--    Mantém security_invoker=true (RD-79, gate check-views-security-invoker).
CREATE OR REPLACE VIEW public.v_projetos_insumos_ui WITH (security_invoker = true) AS
 SELECT i.id,
    i.company_id,
    i.erp_code,
    i.name,
    i.unit,
    i.category,
    i.supplier,
    i.current_cost,
    i.last_cost,
    i.last_purchase_date,
    i.ncm,
    i.status,
    i.source,
    i.api_sync_at,
    i.created_at,
    i.updated_at,
    i.source_type,
    i.source_ref,
    i.is_publico,
    i.forked_from,
    i.especificacao_tecnica,
    i.observacoes,
    ( SELECT count(DISTINCT b.servico_id) AS count
           FROM projetos_servicos_bom b
          WHERE b.insumo_id = i.id) AS qtd_servicos_uso,
        CASE
            WHEN i.forked_from IS NOT NULL THEN jsonb_build_object('id', orig.id, 'name', orig.name, 'preco_publico', orig.current_cost, 'preco_diferente', i.current_cost <> orig.current_cost, 'diferenca_pct',
            CASE
                WHEN orig.current_cost > 0::numeric THEN round((i.current_cost - orig.current_cost) / orig.current_cost * 100::numeric, 1)
                ELSE NULL::numeric
            END)
            ELSE NULL::jsonb
        END AS origem_publica,
        CASE
            WHEN i.last_cost IS NOT NULL AND i.last_cost > 0::numeric AND i.current_cost IS NOT NULL THEN round((i.current_cost - i.last_cost) / i.last_cost * 100::numeric, 1)
            ELSE NULL::numeric
        END AS variacao_pct,
    i.deleted_at,
    i.deleted_by
   FROM m16_insumos i
     LEFT JOIN m16_insumos orig ON orig.id = i.forked_from;

-- 5) RD-98 p3 · origem do dado da tela (grep de src/app/dashboard/projetos/insumos/page.tsx: .from + .rpc)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'v_projetos_insumos_ui',        -- lista de insumos (filtra deleted_at + is_publico=false)
        'm16_insumos',                  -- CRUD do insumo (create/update)
        'projetos_insumo_categorias',   -- categorias do filtro/form
        'hub_insumo_produto',           -- vínculo insumo ↔ produto do estoque (GE)
        'erp_produtos',                 -- produtos do estoque para ligar (custo real)
        'projetos_servicos_bom'         -- contagem "em uso" por serviço (BOM)
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_hub_insumo_vinculos',           -- ligações atuais do insumo com o estoque
        'fn_hub_insumo_buscar_produtos',    -- busca de produtos do estoque para ligar
        'fn_hub_insumo_vincular',           -- liga o insumo ao produto (custo real)
        'fn_hub_insumo_desvincular',        -- desliga (mantém último custo)
        'fn_hub_insumo_custo',              -- custo do estoque p/ o insumo
        'fn_projetos_atualizar_preco_insumo', -- atualiza preço + recalcula serviços
        'fn_projetos_deletar_insumo',       -- exclusão rastreável (RD-98 p4)
        'fn_projetos_restaurar_insumo',     -- restaurar excluído (RD-98 p4)
        'fn_projetos_importar_catalogo_publico' -- importar biblioteca pública
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/insumos';

-- 6) RD-95: "?" das ações/indicadores NOVOS desta entrega (Restaurar e divergência de preço vs estoque).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.insumos.restaurar', '/dashboard/projetos/insumos', 'Insumos', 'Restaurar insumo',
   'Traz de volta um insumo que foi excluído: ele volta à lista como Ativo.',
   'A exclusão é rastreável (guarda quem e quando) e reversível — nada se perde ao excluir por engano.',
   'Excluiu "Rejunte 1kg" sem querer? Mude o filtro Status para "Excluídos", abra a linha e clique em Restaurar.',
   'Procurar o insumo excluído na lista normal — por padrão a lista mostra só os ativos; use o filtro Status "Excluídos".',
   'hub_projetos', 47),
  ('projetos.insumos.divergencia', '/dashboard/projetos/insumos', 'Insumos', 'Preço diverge do estoque',
   'Aparece quando o preço do catálogo é diferente do custo real do produto ligado no estoque (GE).',
   'É um alerta: o custo real da obra usa o estoque, então vale conferir e atualizar o preço do catálogo.',
   'Catálogo R$ 27,00 e estoque R$ 32,00 → diferença de +18,5%.',
   'Orçar pelo preço antigo do catálogo quando o custo do estoque já subiu.',
   'hub_projetos', 48)
ON CONFLICT (chave) DO UPDATE
  SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
      para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo,
      erro_comum = EXCLUDED.erro_comum, atualizado_em = now();

-- 7) Semente DEMO 0006 (idempotente): liga 6 insumos a produtos reais do estoque do GE. Alguns com custo divergente
--    do catálogo, de propósito, para a tela exibir o indicador de divergência. Só DADO DEMO (source_type='demo').
DO $seed$
DECLARE
  v_cid uuid := 'b0700000-0000-4000-a000-000000000006';
  v_pairs jsonb := jsonb_build_array(
    jsonb_build_object('ins','d9a17deb-b2b6-4533-8893-68e2c6a15a4b','prod','7ed78b18-8c0e-4788-af02-09c4d7d3a170'), -- Placa gesso ↔ Chapa gesso
    jsonb_build_object('ins','ddfcdeaf-d78a-45db-b04f-fe1a68b89583','prod','3b007856-de92-47ef-adf4-fa3f8d4cefea'), -- Perfil guia ↔ Guia 48mm (diverge)
    jsonb_build_object('ins','698bed1a-7578-4e34-aa07-235eb307a309','prod','35820a7e-46ae-4bf3-afb5-b7296d05e4aa'), -- Perfil montante ↔ Montante 48mm (diverge)
    jsonb_build_object('ins','9a55228a-da43-40c0-b7ba-0bf82ddf3177','prod','31ab6b44-b71e-47c4-9997-05c03b103c05'), -- Massa junta ↔ Massa junta (diverge)
    jsonb_build_object('ins','356050d0-ba19-41af-b78a-1725aaec71b5','prod','25de6777-cc29-4937-afd8-6a5671980886'), -- Fita telada ↔ Fita junta (diverge)
    jsonb_build_object('ins','d16e0212-f060-4fa8-a8f4-34a1797ebcb2','prod','a2e38cb2-06bd-4e08-96a1-1bc2c2a1ec03')  -- Parafuso GN25 ↔ Parafuso PPA25 (diverge)
  );
  v_pair jsonb;
  v_ins uuid; v_prod uuid;
BEGIN
  -- Só semeia se a empresa DEMO e os dados existirem (ambiente de teste pode não ter).
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_cid) THEN RETURN; END IF;
  FOR v_pair IN SELECT * FROM jsonb_array_elements(v_pairs) LOOP
    v_ins  := (v_pair->>'ins')::uuid;
    v_prod := (v_pair->>'prod')::uuid;
    -- insumo e produto precisam existir e ser da empresa DEMO
    IF NOT EXISTS (SELECT 1 FROM m16_insumos WHERE id = v_ins AND company_id = v_cid AND is_publico = false) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM erp_produtos WHERE id = v_prod AND company_id = v_cid) THEN CONTINUE; END IF;
    -- idempotente: só liga se ainda não há vínculo ativo
    IF EXISTS (SELECT 1 FROM hub_insumo_produto WHERE insumo_id = v_ins AND ativo) THEN CONTINUE; END IF;
    INSERT INTO hub_insumo_produto (company_id, insumo_id, produto_id, usar_maior_custo, ativo, created_by)
    VALUES (v_cid, v_ins, v_prod, false, true, NULL);
  END LOOP;
END
$seed$;
