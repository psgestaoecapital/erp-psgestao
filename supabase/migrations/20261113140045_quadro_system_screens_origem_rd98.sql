-- Quadro de pessoal (Indústria) · /dashboard/industrial/rh/quadro
-- RD-98 p3 (origem do dado): o auditor aud8 (88/95) apontou que system_screens dessa rota estava com
--   views_consumidas e rpcs_chamadas VAZIOS (NULL). A tela, de fato, lê 4 tabelas e chama 5 funções de
--   negócio + fn_ajuda_campo_listar (RD-95, "?" em cada campo). Esta migration preenche a origem real.
--
-- Fontes conferidas no código (src/app/dashboard/industrial/rh/quadro/page.tsx):
--   tabelas (.from): folha_competencia, rh_parametro_custo, prod_cargo, prod_setor
--   funções (.rpc): fn_rh_quadro_pessoas, fn_rh_custo_por, fn_rh_parametro_custo_salvar,
--                   fn_rh_pessoa_complemento_salvar, fn_rh_pessoa_complemento_lote
--   ajuda (AjudaCampo): fn_ajuda_campo_listar (uma chamada por tela)
--
-- Idempotente (define os arrays exatos) e escopada só a esta rota. Metadado de tela — NÃO toca dado de
-- cliente, função, RLS nem regra fiscal/financeira. Faixa de segundos do desenvolvedor_4_g (:45).

UPDATE public.system_screens
SET views_consumidas = ARRAY['folha_competencia','rh_parametro_custo','prod_cargo','prod_setor']::text[],
    rpcs_chamadas = ARRAY['fn_rh_quadro_pessoas','fn_rh_custo_por','fn_rh_parametro_custo_salvar','fn_rh_pessoa_complemento_salvar','fn_rh_pessoa_complemento_lote','fn_ajuda_campo_listar']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/industrial/rh/quadro';
