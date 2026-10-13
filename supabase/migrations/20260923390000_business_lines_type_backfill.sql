-- business_lines.type — backfill das linhas operacionais que nasceram sem type.
-- A porta que gerava linhas com type NULL era a tela LinhasNegocioList (insert sem type),
-- corrigida no mesmo PR (agora grava type='servico', igual ao caminho oficial fn_psgc_cadastrar_ln).
-- O seed de demonstração (api/demo/seed) também usava colunas inexistentes (nome/tipo) — corrigido.
--
-- ⚠️ IMPORTANTE: isto NÃO abre o DRE Divisional. O caminho do DRE (v_dre_divisional_completo →
-- v_psgc_dre_divisional) NÃO filtra por business_lines.type; a tela trava em qtdLnsAtivas>=2, que
-- conta grupos de ln_id no psgc_dre — não linhas com type. Este backfill é higiene de cadastro.
--
-- Preenche: PS GESTAO & CAPITAL (5 linhas) + Ps Gestao LTDA (4) + Umuarama SÓ "Gado".
-- Umuarama "Soja" e "EXTRA" ficam NULL de propósito: soja é arrendada (não é linha operacional da
-- pecuária) e a taxonomia de "fora do rateio" ainda não foi definida — não inventar type para elas.
-- Provado em rollback: 10 atualizadas; Umuarama Soja+EXTRA seguem NULL. RD-52 (arquivo=ledger).

UPDATE public.business_lines SET type = 'servico'
 WHERE type IS NULL
   AND (
     company_id IN (
       '25305b15-09e1-4abe-944f-9bff31743350',  -- PS GESTAO & CAPITAL (5 linhas)
       'b26c19c0-bf6d-495b-b8d1-9fa8d6896725'   -- Ps Gestao LTDA (4 linhas)
     )
     OR (company_id = '636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND name = 'Gado')  -- Umuarama: só Gado
   );
