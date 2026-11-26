-- conserto-main(@pos · DEMO): o reset da DEMO Indústria (…005) voltou a falhar para os usuários E2E
-- (@pos 26/11 11:14 — caminho-compliance-epi, caminho-compliance-sst-ltcat, demo-industria-sst, epi-entrega-digest,
-- ltcat-funcoes-77, ltcat-riscos-setor-77: "rpc fn_demo_reset falhou: 403 sem_acesso").
-- Causa: 20261128030040 passou a chamar fn_demo_seed_industria_nr36 dentro do fn_demo_reset da 005. Esse seed chama
-- funções de TELA (fn_nr36_regra_seed_padrao → fn_nr36_assert, que exige vínculo do usuário com a empresa) e apaga
-- marcação de ponto (bloqueado pelo trigger RD-30). fn_demo_reset só exige is_demo (qualquer autenticado reseta DEMO,
-- por desenho), então o seed NR-36 derrubava o reset INTEIRO da 005.
-- Correção mínima: o bloco NR-36 roda isolado (subtransação). Se falhar, o reset do resto da 005 segue e o motivo vai
-- no retorno ('nr36': {ok:false, erro}). Nenhuma guarda é afrouxada. O conserto do seed NR-36 em si fica com o autor.
-- ci-sem-guarda: fn_demo_reset — reset de empresa DEMO; confere is_demo e aborta ('nao_e_demo') em empresa real; só repopula seeds de demonstração, nunca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb;
  v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb; v_fis jsonb; v_dre jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000005'::uuid THEN 'fn_gold_sst_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000006'::uuid THEN 'fn_demo_seed_construtora'
    WHEN 'b0700000-0000-4000-a000-00000000000b'::uuid THEN 'fn_gold_sst_seed_reparar'  -- DEMO EHS (plano Compliance)
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  -- conserto-main 14/11 (gilberto-esteira): a DEMO 005/00b apaga prod_setor no seed principal; o complemento de
  -- RH da rodada anterior (rh_pessoa_complemento.setor_id -> prod_setor, FK NO ACTION) bloqueia esse DELETE.
  -- Limpa o complemento FICTÍCIO ANTES dos seeds (fn_demo_seed_industria_rh_quadro o re-semeia no fim).
  -- is_demo já validado acima; dado 100% fake (RD-69/LGPD); nenhum cliente é tocado.
  IF p_company_id IN ('b0700000-0000-4000-a000-000000000005'::uuid,
                      'b0700000-0000-4000-a000-00000000000b'::uuid) THEN
    DELETE FROM public.rh_pessoa_complemento WHERE company_id = p_company_id;
    -- rh_vaga referencia prod_setor (FK RESTRICT); limpar antes do seed principal que apaga prod_setor
    -- (mesmo motivo do rh_pessoa_complemento). fn_demo_seed_industria_rh_quadro re-insere no fim.
    -- SUPERSET da conserto-main #5748 (mergeada; destrava o @pos): com 00b + este DELETE, qualquer ordem
    -- de aplicação deixa o fn_demo_reset correto (dado 100% fake, is_demo validado; nenhum cliente é tocado).
    DELETE FROM public.rh_vaga WHERE company_id = p_company_id;
  END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_fin := fn_demo_seed_ge_financeiro(p_company_id);
    v_ban := fn_demo_seed_ge_bancos(p_company_id);
    v_fis := fn_demo_seed_ge_fiscal(p_company_id);
    v_dre := fn_demo_seed_ge_dre(p_company_id);  -- [GE G0-F] Bloco 6: assinatura R$0 + DRE 6 meses
    -- 18/11 (code-desenvolvedor-3 · PDCA cartões, #5477): remove a poluição do e2e "CIELO ACEITE" na DEMO GE
    -- (adquirentes/taxas/repasses de teste), para a lista da tela de cartões não acumular entre rodadas.
    -- SUPERSET do corpo vivo (reconciliar_cartoes · 20261123200030): sem esta linha, aplicar esta migration
    -- por último reverteria a limpeza de cartões. Mantido idêntico ao corpo vivo + o ramo 00b abaixo.
    -- 23/11 (code-desenvolvedor-3 · PDCA contas ACEITE PARCIAL, bbe328ac): mesma lógica para erp_banco_contas,
    -- para o seletor de conta (extrato/pagar/receber/conciliação) não voltar a acumular contas de teste.
    v_res := COALESCE(v_res, '{}'::jsonb)
      || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre)
      || jsonb_build_object('cartoes_limpeza', public.fn_demo_ge_limpar_cartoes_teste(p_company_id))
      || jsonb_build_object('contas_limpeza', public.fn_demo_ge_limpar_contas_teste(p_company_id));
  END IF;

  -- 02/10: Pauta da P&M com cenário realista (atrasados, vence hoje, aguardando, rodadas)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta', public.fn_demo_seed_pm_pauta(p_company_id));
  END IF;

  -- 02/10 (PM-B): visões salvas da Pauta (link ?visao=)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_visoes', public.fn_demo_seed_pm_visoes(p_company_id));
  END IF;

  -- 02/10 (PM-C): rodadas, aprovações com prazo e motivos de espera da Pauta
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_fluxo', public.fn_demo_seed_pm_fluxo(p_company_id));
  END IF;

  -- 03/10 (Social): planejamento do mês de 2 clientes, posts e os jobs dos aprovados
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('social', public.fn_demo_seed_pm_social(p_company_id));
  END IF;

  -- 02/10 (PM-D): Meu dia — menções com @, anotações e horas de hoje
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_dia', public.fn_demo_seed_pm_dia(p_company_id));
  END IF;

  -- 31/10 (dev7claudeps · PDCA margem-job): serviço/valor/custo nos jobs + fees, para Margem por Serviço e por Fee
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('margem', public.fn_demo_seed_pm_margem(p_company_id));
  END IF;

  -- 07/11 (desenvolvedor_4_g · PDCA /dashboard/pm): a cada reset, reaplica a limpeza dos clientes de
  -- teste (E2E/[BOT]/teste/screenshot SEM job/contrato ativo) para o KPI "Clientes ativos" não voltar
  -- a inflar entre rodadas de E2E. Idempotente e travado em empresa is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('limpeza_clientes_teste', public.fn_demo_pm_limpar_clientes_teste(p_company_id));
  END IF;

  -- 01/11 (PDCA Hub · simulador): simulações salvas reais da construtora DEMO (bloco "Simulações salvas" não fica vazio)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  -- 08/11 (dev7claudeps · RH/Postos genérico, CEO 08/11): quadro de postos do abatedouro FICTÍCIO da DEMO de
  -- indústria (setor → posto → pessoa com CPF manual + custo por posto; postos vazios = vagas). RD-69: tudo FAKE.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
  END IF;

  -- 16/11 (code-desenvolvedor-3 · EHS S1 piloto, re-seed RECONCILIADO pós-reversão do #5174): matrizes de
  -- risco (S1.1), EPI (S1.2) e treino (S1.3) por setor/posto, DURÁVEIS a cada reset (os seeds das migrations
  -- são one-shot e o reset os apagava). RECONCILIADO com o caminho protegido SST·LTCAT: a função NÃO semeia
  -- RISCO na Desossa (Desossa começa vazia, como o teste exige); EPI e treino seguem em todos. Roda DEPOIS
  -- dos postos (precisa dos postos/setores). RD-69: tudo FAKE; trava is_demo na função.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
  END IF;

  -- 12/11 (desenvolvedor_4_g · PDCA aud8 Controle de frota, DEMO 005): frota FICTÍCIA (veículos + planos de
  -- manutenção + documentos + custos + viagens/abastecimento) para os 6 KPIs da tela de frota deixarem de
  -- ficar zerados e a jornada de inclusão/edição/custo ser verificável. RD-69: tudo FAKE. Idempotente e is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('frota', public.fn_demo_seed_industria_frota(p_company_id));
  END IF;

  -- 19/11 (desenvolvedor_4_g · PDCA aud8 Quadro de pessoal, DEMO 005): re-semeia o complemento de RH (cargo,
  -- setor, supervisor, salário-base) e a jornada/escala por colaborador do ponto, que o reset APAGA no início
  -- (conserto-main 14/11) mas deixou de re-semear. Roda por ÚLTIMO no bloco da 005 — depois de postos recriar
  -- prod_setor/prod_cargo que o re-seed referencia por nome. Sem isso Supervisor/Escala/Carga/Salário ficam "—"
  -- na tela /dashboard/industrial/rh/quadro. Idempotente e travado em is_demo (RD-69: dado 100% fictício).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 24/11 (code-desenvolvedor-3 · PDCA aud8 NR-36 pausas térmicas, DEMO 005): semeia o APARATO NR-36 completo
  -- (ponto na janela corrente + regras legais canônicas + elegíveis + upload processado + pausas realizadas
  -- com mix conforme/desvio/pendente) e APURA, para a tela /dashboard/industrial/nr36 (Painel/Conferência/
  -- Ciência) deixar de abrir zerada. Janela RELATIVA (mês-1..hoje) => durável a cada reset (não re-envelhece).
  -- Roda por ÚLTIMO no bloco da 005 (precisa de ponto/colaboradores). RD-69: dado 100% fictício; is_demo + 005.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    BEGIN
      v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('nr36', public.fn_demo_seed_industria_nr36(p_company_id));
    EXCEPTION WHEN OTHERS THEN
      -- conserto 26/11: o seed NR-36 não derruba o reset da 005 (subtransação desfeita, motivo no retorno).
      v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('nr36', jsonb_build_object('ok', false, 'erro', SQLERRM));
    END;
  END IF;

  -- 20/11 (code-desenvolvedor-3 · EHS-0, CEO 20/11 16:40): ramo da DEMO EHS "EHS Modelo - DEMO" (00b).
  -- Dados auditáveis nas 24 telas /dashboard/ehs/*, como nas outras verticais. Base SST (fn_gold_sst_seed_reparar
  -- acima via v_seed) + postos + matrizes de risco/EPI/treino + quadro de RH. SEM frota (plano só Compliance).
  -- Cada bloco é company-scoped e is_demo; roda na ordem de dependência (postos → ehs_matrizes → rh_quadro).
  IF p_company_id = 'b0700000-0000-4000-a000-00000000000b'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- check_fn_guards: REVOKE anon idempotente também na função redefinida (régua da versão mais nova).
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
