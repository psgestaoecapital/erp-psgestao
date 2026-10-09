-- Hub HB2 · Calculadora de Obra (fatia 2): "?" de ajuda dos campos (RD-95) e cadastro da tela em system_screens.
-- Aditiva: só INSERT (ON CONFLICT DO NOTHING). Sem dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'projetos', 'publicado'
FROM (VALUES
 ('calc.parede.comprimento','Comprimento da parede','O comprimento total da parede, em metros, medido na planta ou na obra.','Define quantas guias e montantes entram e, com o pé-direito, a área de chapa.','12,5','Somar o comprimento de paredes diferentes: calcule uma parede (ou um trecho igual) por vez.',10),
 ('calc.parede.pe_direito','Pé-direito','A altura da parede, do piso ao teto, em metros.','Escolhe a bitola e o espaçamento dos montantes pela faixa de altura e entra na área de chapa e de parafusos.','2,8','Usar a altura do pé-direito da laje, e não a da parede acabada.',11),
 ('calc.parede.vaos','Vãos a descontar','A soma da área, em m², de portas e janelas que não levam chapa.','É subtraída da área da parede antes de calcular chapas, parafusos, massa e fita.','Porta 0,8 × 2,1 = 1,68','Digitar a largura da porta em vez da área.',12),
 ('calc.forro.largura','Largura do forro','A menor dimensão do ambiente a forrar, em metros.','Com o comprimento, dá a área e o perímetro (tabica).','3','Medir de fora a fora da parede em vez do vão livre.',20),
 ('calc.forro.comprimento','Comprimento do forro','A maior dimensão do ambiente a forrar, em metros.','Com a largura, dá a área do forro e o perímetro da tabica.','4','Trocar metros por centímetros.',21),
 ('calc.resultado.area','Área calculada','Não se preenche: é a área líquida usada em toda a conta.','Base de chapas, parafusos, massa e fita.','33,32 m²','Estranhar a área sem lembrar do desconto dos vãos.',30),
 ('calc.resultado.ver_conta','Ver a conta','Clique em "ver a conta" na linha do material.','Mostra a fórmula com os números usados, para você conferir ou ajustar o pedido.','12,5 m × 2 × 1,05 ÷ 3 m por barra','Comprar a quantidade "necessária" sem arredondar para a embalagem: a coluna grande já vem arredondada.',31)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional)
VALUES ('dashboard.projetos_calculadora','/dashboard/projetos/calculadora','hub_construcao','Calculadora de Obra','Quantitativo de material de drywall (parede simples e forro F530) com a conta visível')
ON CONFLICT (id) DO NOTHING;
