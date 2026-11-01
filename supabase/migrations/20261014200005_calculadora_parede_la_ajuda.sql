-- HB2 · Calculadora de Obra: "?" (RD-95) da lã mineral na parede (opção na tela + rolo nas regras da empresa). Aditiva (só ajuda). Faixa 05.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.la', 'Com lã mineral no miolo', 'Marque se a parede leva lã mineral (ou PET) dentro do miolo, para isolamento térmico e acústico.', 'Acrescenta o item lã à lista de compra, sobre a área já descontada dos vãos, com a perda das regras.', 'Parede de 33,32 m² → 5 rolos de 7,2 m²', 'Marcar para parede que não é acústica e comprar rolo a mais.', 14),
 ('projetos.calculadora.regra.parede.larolom2', 'Rolo de lã (parede)', 'Informe a área de um rolo de lã mineral (m²), ex.: 1,20 × 6,00 = 7,2.', 'Divide a área da parede para achar quantos rolos comprar; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', '7,2 m²', 'Informar a largura do rolo em vez da área, ou deixar vazio.', 72)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
