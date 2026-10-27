-- Hub · Calculadora de Obra: "?" do selo "Fórmula validada" (RD-95). Aditiva: só texto de ajuda novo, sem dado de
-- cliente, sem RLS/grants. Faixa desenvolvedor_4_g (segundos 52). Fecha o gap da auditoria FC (bate_com_banco/
-- "conferir fórmula drywall/forro/revestimento"): a tela mostra que a conta de cada sistema bate com o caso de
-- referência conferido à mão (src/lib/calculadora/referencia.ts), provado pelo gate check-calculadora-referencia.ts.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.calculadora.formula_validada', 'Calculadora', 'Fórmula validada',
  'Nada a preencher: é um selo. Toque em "ver a referência conferida" para ver o caso usado na checagem.',
  'Mostra que a conta de material deste sistema bate com um caso de referência conferido à mão (ex.: a parede do caso real da obra). A quantidade que o selo mostra como "esperada" é exatamente a que o cálculo devolve — por isso você confia que o número da calculadora fecha com a engenharia, não é um palpite.',
  'Parede simples, caso 12,5 × 2,8 m com porta: área 33,32 m², 33 chapas, 9 guias, 21 montantes — a calculadora devolve os mesmos números, então aparece "Fórmula validada".',
  'Confundir com os preços: o selo valida a QUANTIDADE de material (a conta), não o preço. O custo em reais vem do produto vinculado ao estoque. Valores de perda/consumo das regras ainda são referência de mercado, a validar com o fabricante em "Mostrar parâmetros avançados".',
  12, '/dashboard/projetos/calculadora')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
