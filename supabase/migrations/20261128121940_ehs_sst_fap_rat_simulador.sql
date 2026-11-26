-- 20261127070140 · code-desenvolvedor-3 · EHS-F slice-c1 — Simulador FAP/RAT (standalone, SEM financeiro)
-- Parte F.2 do PS EHS V11: "simulador FAP/RAT funciona sem o financeiro". É uma CALCULADORA pura (legislação como
-- dado, E.1): não lê nem grava nenhuma tabela, não depende do adicional financeiro (GE) nem de dado de cliente.
-- Fundamento legal (comentário, não é nome de sistema de terceiros — RD-100): contribuição SAT/RAT de 1/2/3%
-- conforme o grau de risco (Lei 8.212/91 art.22, II); o RAT é multiplicado pelo FAP, que varia de 0,5000 a 2,0000
-- (Lei 10.666/2003 art.10; Decreto 6.957/2009). A alíquota efetiva recolhida = RAT_nominal × FAP.
-- Idempotente. Função IMMUTABLE (puro cálculo de entrada), SECURITY INVOKER, sem acesso a tabela; REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_ehs_fap_rat_simular(
  p_base_folha numeric,
  p_rat_grau   integer,
  p_fap        numeric
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rat_nominal_pct numeric;      -- 1, 2 ou 3 (%)
  v_fap             numeric;
  v_folha           numeric;
  v_rat_efetivo_pct numeric;      -- RAT × FAP (%)
  v_contrib_nominal numeric;      -- R$/mês com FAP neutro (1,0000)
  v_contrib_efetiva numeric;      -- R$/mês com o FAP informado
  v_economia_mes    numeric;      -- positivo = economia (FAP<1); negativo = acréscimo (FAP>1)
BEGIN
  -- validações (erro em linguagem do usuário, nunca erro cru)
  v_folha := coalesce(p_base_folha, 0);
  IF v_folha < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A base da folha não pode ser negativa.');
  END IF;

  IF p_rat_grau IS NULL OR p_rat_grau NOT IN (1, 2, 3) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O grau de risco deve ser 1 (leve), 2 (médio) ou 3 (grave).');
  END IF;

  v_fap := coalesce(p_fap, 1.0);
  IF v_fap < 0.5 OR v_fap > 2.0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O FAP deve ficar entre 0,5000 e 2,0000 (faixa legal).');
  END IF;

  v_rat_nominal_pct := CASE p_rat_grau WHEN 1 THEN 1.0 WHEN 2 THEN 2.0 WHEN 3 THEN 3.0 END;
  v_rat_efetivo_pct := round(v_rat_nominal_pct * v_fap, 4);

  v_contrib_nominal := round(v_folha * v_rat_nominal_pct / 100.0, 2);
  v_contrib_efetiva := round(v_folha * v_rat_nominal_pct * v_fap / 100.0, 2);
  v_economia_mes    := round(v_contrib_nominal - v_contrib_efetiva, 2);

  RETURN jsonb_build_object(
    'ok', true,
    'base_folha', round(v_folha, 2),
    'rat_grau', p_rat_grau,
    'rat_nominal_pct', v_rat_nominal_pct,
    'fap', round(v_fap, 4),
    'rat_efetivo_pct', v_rat_efetivo_pct,
    'contrib_nominal_mes', v_contrib_nominal,
    'contrib_efetiva_mes', v_contrib_efetiva,
    'economia_mes', v_economia_mes,
    'economia_ano', round(v_economia_mes * 12, 2),
    'sentido', CASE WHEN v_economia_mes > 0 THEN 'economia'
                    WHEN v_economia_mes < 0 THEN 'acrescimo'
                    ELSE 'neutro' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ehs_fap_rat_simular(numeric, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_fap_rat_simular(numeric, integer, numeric) TO authenticated;

-- "?" RD-95 de todos os campos e indicadores da tela (chave = ehs.fap_rat.*, rota exata da tela)
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.fap_rat.base_folha', '/dashboard/ehs/sst/fap-rat', 'Simulador FAP/RAT', 'Base da folha (R$/mês)',
   'Informe o total mensal da folha de pagamento que serve de base para a contribuição SAT/RAT (remunerações seguradas no mês).',
   'É sobre esse valor que incide a alíquota RAT ajustada pelo FAP. Multiplicado pela alíquota efetiva, resulta na contribuição mensal de SST.',
   'Folha de R$ 120.000,00 no mês.',
   'Informar a folha anual em vez da mensal — o simulador trabalha com a base mensal e já projeta o ano.',
   'ehs', 1, 1, 'publicado'),
  ('ehs.fap_rat.rat_grau', '/dashboard/ehs/sst/fap-rat', 'Simulador FAP/RAT', 'Grau de risco (RAT)',
   'Selecione o grau de risco da atividade preponderante: 1 (leve) = 1%, 2 (médio) = 2% ou 3 (grave) = 3%.',
   'Define a alíquota RAT nominal antes do FAP. O grau vem do enquadramento da atividade preponderante da empresa.',
   'Atividade de risco médio → grau 2 → RAT nominal 2%.',
   'Escolher o grau pela atividade de um setor isolado e não pela atividade preponderante da empresa.',
   'ehs', 2, 1, 'publicado'),
  ('ehs.fap_rat.fap', '/dashboard/ehs/sst/fap-rat', 'Simulador FAP/RAT', 'FAP (0,5000 a 2,0000)',
   'Informe o FAP vigente da empresa (Fator Acidentário de Prevenção), um multiplicador entre 0,5000 e 2,0000.',
   'O FAP multiplica o RAT nominal: abaixo de 1,0000 reduz a contribuição (prêmio por prevenção); acima de 1,0000 aumenta (mais acidentes).',
   'FAP de 0,7500 sobre RAT 2% → alíquota efetiva de 1,50%.',
   'Digitar o FAP como porcentagem (ex.: 75) — use o fator decimal (0,7500).',
   'ehs', 3, 1, 'publicado'),
  ('ehs.fap_rat.rat_efetivo', '/dashboard/ehs/sst/fap-rat', 'Simulador FAP/RAT', 'Alíquota efetiva (RAT × FAP)',
   'Resultado: a alíquota realmente recolhida, igual ao RAT nominal multiplicado pelo FAP.',
   'É a alíquota que a empresa paga de fato sobre a folha; evidencia o efeito do FAP sobre o custo de SST.',
   'RAT 2% × FAP 0,7500 = 1,50%.',
   'Confundir a alíquota efetiva com o RAT nominal — elas só coincidem quando o FAP é 1,0000.',
   'ehs', 4, 1, 'publicado'),
  ('ehs.fap_rat.economia', '/dashboard/ehs/sst/fap-rat', 'Simulador FAP/RAT', 'Economia / acréscimo do FAP',
   'Resultado: a diferença, em R$, entre pagar com FAP neutro (1,0000) e com o FAP informado — por mês e projetada no ano.',
   'Mostra em dinheiro quanto a prevenção economiza (ou quanto os acidentes custam) via FAP, o retorno das ações de SST.',
   'FAP 0,7500 sobre folha R$ 120.000 e RAT 2% economiza R$ 600/mês (R$ 7.200/ano).',
   'Ler um valor negativo como economia — negativo é acréscimo (FAP acima de 1,0000).',
   'ehs', 5, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;

-- a tela aparece no inventário (entrega só conta se o usuário a enxerga)
-- system_screens.id é text NOT NULL SEM default: o id (slug) tem de ser fornecido no INSERT (conserto-main)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real)
VALUES ('dashboard.ehs_sst_fap_rat', '/dashboard/ehs/sst/fap-rat', 'compliance', 'Simulador FAP/RAT',
        'Calculadora de contribuição SAT/RAT ajustada pelo FAP: base da folha × grau de risco × FAP → alíquota efetiva, contribuição mensal e economia/acréscimo no ano. Funciona sem o adicional financeiro.',
        'parcial')
ON CONFLICT (rota) DO UPDATE SET
  titulo = EXCLUDED.titulo, area = EXCLUDED.area, descricao_funcional = EXCLUDED.descricao_funcional;
