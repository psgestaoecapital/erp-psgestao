-- Produtividade › Cadastro por fluxo: o seletor de Cargo do posto lista TODAS as funções do ponto (CEO 07/10, caixa 34a7248e).
-- Fonte única = o PONTO (ind_ponto_colaborador.funcao, RD-65). A LISTA continua vindo de fn_prod_sugerir_cargos (já existente, só função +
-- contagem, sem dado pessoal, guarda de empresa). Esta função NOVA faz a ESCRITA ao escolher uma função:
--   · p_funcao informada: reusa o prod_cargo de mesmo nome (comparação fn_prod_norm: sem acento/maiúscula) ou cria um, e grava em
--     prod_cargo_vinculo (fonte = o ponto da planta, chave = a função) uma linha por grafia distinta da função que existe no ponto,
--     se ainda não existir (ON CONFLICT DO NOTHING; nunca altera nem apaga vínculo existente);
--   · p_funcao NULL: vincula ao ponto os prod_cargo JÁ cadastrados cuja função existe no ponto (não cria cargo).
-- Aditiva: função nova + só INSERT em tabelas já com RLS por empresa. SECURITY DEFINER com search_path e guarda de empresa;
-- REVOKE de PUBLIC/anon. Nota (RD-38): o "ponto: N vínculo(s)" do cabeçalho do fluxo conta prod_setor_vinculo (fn_prod_fluxo_completo),
-- NÃO prod_cargo_vinculo — por isso a tela passa a mostrar também "cargos ligados ao ponto: N" (leitura direta de prod_cargo_vinculo).

CREATE OR REPLACE FUNCTION public.fn_prod_cargo_do_ponto_vincular(p_company_id uuid, p_plant_id uuid, p_funcao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_fonte uuid; v_cargo uuid; v_nome text; v_k text; v_novos int := 0; v_n int; r record;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM industrial_plants WHERE id = p_plant_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_invalida'); END IF;

  SELECT id INTO v_fonte FROM prod_fonte_dados
   WHERE company_id = p_company_id AND plant_id = p_plant_id AND tipo = 'ponto'
   ORDER BY ativo DESC, created_at LIMIT 1;
  IF v_fonte IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_fonte_ponto'); END IF;

  -- funções distintas do ponto (≤ dezenas por planta), cada grafia com sua contagem e a chave normalizada
  CREATE TEMP TABLE IF NOT EXISTS _pcv_funcoes (chave text, pessoas int, k text) ON COMMIT DROP;
  TRUNCATE _pcv_funcoes;
  INSERT INTO _pcv_funcoes (chave, pessoas, k)
  SELECT g.chave, g.pessoas, fn_prod_norm(g.chave) FROM (
    SELECT btrim(funcao) AS chave, count(*)::int AS pessoas FROM ind_ponto_colaborador
     WHERE company_id = p_company_id AND plant_id = p_plant_id AND COALESCE(btrim(funcao),'') <> ''
     GROUP BY btrim(funcao)) g;

  IF p_funcao IS NOT NULL THEN
    v_k := fn_prod_norm(p_funcao);
    IF v_k = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'funcao_vazia'); END IF;
    SELECT chave INTO v_nome FROM _pcv_funcoes WHERE k = v_k ORDER BY pessoas DESC, chave LIMIT 1;
    IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'funcao_nao_esta_no_ponto'); END IF;
    SELECT id INTO v_cargo FROM prod_cargo
     WHERE company_id = p_company_id AND plant_id = p_plant_id AND fn_prod_norm(nome) = v_k ORDER BY created_at LIMIT 1;
    IF v_cargo IS NULL THEN
      INSERT INTO prod_cargo (company_id, plant_id, nome) VALUES (p_company_id, p_plant_id, v_nome)
      ON CONFLICT (company_id, plant_id, nome) DO NOTHING RETURNING id INTO v_cargo;
      IF v_cargo IS NULL THEN
        SELECT id INTO v_cargo FROM prod_cargo WHERE company_id = p_company_id AND plant_id = p_plant_id AND nome = v_nome;
      END IF;
    END IF;
    INSERT INTO prod_cargo_vinculo (company_id, plant_id, cargo_id, fonte_id, chave, rotulo)
    SELECT p_company_id, p_plant_id, v_cargo, v_fonte, f.chave, f.chave FROM _pcv_funcoes f WHERE f.k = v_k
    ON CONFLICT (fonte_id, chave) DO NOTHING;
    GET DIAGNOSTICS v_novos = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'cargo_id', v_cargo, 'nome', v_nome, 'vinculos_novos', v_novos,
      'vinculos_total', (SELECT count(*) FROM prod_cargo_vinculo WHERE cargo_id = v_cargo AND fonte_id = v_fonte));
  END IF;

  FOR r IN SELECT c.id, fn_prod_norm(c.nome) AS k FROM prod_cargo c WHERE c.company_id = p_company_id AND c.plant_id = p_plant_id LOOP
    INSERT INTO prod_cargo_vinculo (company_id, plant_id, cargo_id, fonte_id, chave, rotulo)
    SELECT p_company_id, p_plant_id, r.id, v_fonte, f.chave, f.chave FROM _pcv_funcoes f WHERE f.k = r.k
    ON CONFLICT (fonte_id, chave) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_novos := v_novos + v_n;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'vinculos_novos', v_novos);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_cargo_do_ponto_vincular(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_cargo_do_ponto_vincular(uuid, uuid, text) TO authenticated, service_role;
