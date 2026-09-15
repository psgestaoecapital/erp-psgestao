-- ============================================================
-- FC GO-LIVE · aplica o gerencial padrão+ramo na FC e importa o plano CONTÁBIL (144)
-- ============================================================
-- FC PISOS (producao) estava ZERADA. Aqui, de forma ADITIVA e idempotente:
--   (1) copia o template gerencial GLOBAL (87 padrão + 6 do ramo de obra) como contas da FC;
--   (2) importa as 144 contas CONTÁBEIS do contador (117 analíticas · 27 sintéticas), preservando
--       codigo estruturado, pai_codigo (saltos de nível já resolvidos), codigo_antigo (col.3) e
--       observacao_contador (col.4);
--   (3) monta o psgc_depara 4.x das obras → custo de obra cai no CMV do DRE (não em 6.11/despesa).
-- Direto (não via RPC), pois roda no deploy-migrations sem usuário autenticado. Escopo: só a FC.
-- Em ambiente fresh sem o template global de 87, a FC recebe só o que existir de global — inócuo.

-- (1) template gerencial global → FC
INSERT INTO public.erp_plano_contas
  (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador, sugerida_global)
SELECT 'b202b50f-37cb-462e-accf-126869de49f0'::uuid, g.codigo, g.descricao, g.grupo, g.tipo, g.pai_codigo, g.nivel, true, g.is_totalizador, false
FROM public.erp_plano_contas g
WHERE g.company_id IS NULL AND g.ativo
  AND NOT EXISTS (SELECT 1 FROM public.erp_plano_contas e WHERE e.company_id = 'b202b50f-37cb-462e-accf-126869de49f0'::uuid AND e.codigo = g.codigo);

-- (2) plano CONTÁBIL da FC (144) → erp_conta_contabil
INSERT INTO public.erp_conta_contabil
  (company_id, codigo, descricao, analitica, pai_codigo, nivel, codigo_antigo, observacoes, ativo)
SELECT 'b202b50f-37cb-462e-accf-126869de49f0'::uuid, r->>'codigo', r->>'descricao', (r->>'analitica')::boolean,
       NULLIF(r->>'pai_codigo',''), NULLIF(r->>'nivel','')::int,
       NULLIF(r->>'codigo_antigo',''), NULLIF(r->>'observacoes',''), true
FROM jsonb_array_elements($json$[
{
"codigo": "6",
"descricao": "RECEITAS",
"analitica": false,
"pai_codigo": null,
"nivel": 1,
"codigo_antigo": "312",
"observacoes": null
},
{
"codigo": "6.01",
"descricao": "RECEITAS DIVERSAS",
"analitica": false,
"pai_codigo": "6",
"nivel": 2,
"codigo_antigo": "313",
"observacoes": null
},
{
"codigo": "6.01.01",
"descricao": "RECEITAS OPERACIONAIS",
"analitica": false,
"pai_codigo": "6.01",
"nivel": 3,
"codigo_antigo": "314",
"observacoes": null
},
{
"codigo": "6.01.01.01",
"descricao": "RECEITA BRUTA DE VENDAS",
"analitica": false,
"pai_codigo": "6.01.01",
"nivel": 4,
"codigo_antigo": "315",
"observacoes": null
},
{
"codigo": "6.01.01.01.00001",
"descricao": "Vendas à vista (dinheiro)",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "316",
"observacoes": null
},
{
"codigo": "6.01.01.01.00002",
"descricao": "Vendas de Prestação de Serviços",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "322",
"observacoes": "É SOMENTE QUESTÃO DE NOMENCLATURA O CORRETO É"
},
{
"codigo": "6.01.01.01.00003",
"descricao": "Vendas cheque",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "317",
"observacoes": "RECEITA DE OS"
},
{
"codigo": "6.01.01.01.00004",
"descricao": "Vendas de mercadorias cartão crédito",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "318",
"observacoes": null
},
{
"codigo": "6.01.01.01.00005",
"descricao": "Vendas de mercadorias cartão débito",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "319",
"observacoes": null
},
{
"codigo": "6.01.01.01.00006",
"descricao": "Vendas de produtos de fabricação própria p/ exterior",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "321",
"observacoes": null
},
{
"codigo": "6.01.01.01.00008",
"descricao": "Vendas de serviços prestados com substituição tributária",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "323",
"observacoes": null
},
{
"codigo": "6.01.01.01.00009",
"descricao": "Vendas de serviços prestados para o exterior",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "324",
"observacoes": null
},
{
"codigo": "6.01.01.01.00010",
"descricao": "Vendas PIX / Sicredi",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "358",
"observacoes": null
},
{
"codigo": "6.01.01.01.00011",
"descricao": "Vendas PIX Banco do Brasil — à vista",
"analitica": true,
"pai_codigo": "6.01.01.01",
"nivel": 5,
"codigo_antigo": "320",
"observacoes": null
},
{
"codigo": "6.01.01.02",
"descricao": "(-) DEDUÇÕES DA RECEITA BRUTA",
"analitica": false,
"pai_codigo": "6.01.01",
"nivel": 4,
"codigo_antigo": "325",
"observacoes": null
},
{
"codigo": "6.01.01.02.00001",
"descricao": "COFINS",
"analitica": true,
"pai_codigo": "6.01.01.02",
"nivel": 5,
"codigo_antigo": "330",
"observacoes": "ESTÁ CORRETO A CLASSIFICAÇÃO"
},
{
"codigo": "6.01.01.02.00002",
"descricao": "Devoluções de vendas",
"analitica": true,
"pai_codigo": "6.01.01.02",
"nivel": 5,
"codigo_antigo": "332",
"observacoes": null
},
{
"codigo": "6.01.01.02.00003",
"descricao": "ICMS",
"analitica": true,
"pai_codigo": "6.01.01.02",
"nivel": 5,
"codigo_antigo": "328",
"observacoes": null
},
{
"codigo": "6.01.01.02.00004",
"descricao": "ISS",
"analitica": true,
"pai_codigo": "6.01.01.02",
"nivel": 5,
"codigo_antigo": "329",
"observacoes": "ESTÁ CORRETO A CLASSIFICAÇÃO"
},
{
"codigo": "6.01.01.02.00005",
"descricao": "ISS substituição tributária",
"analitica": true,
"pai_codigo": "6.01.01.02",
"nivel": 5,
"codigo_antigo": "327",
"observacoes": null
},
{
"codigo": "6.01.01.02.00006",
"descricao": "PIS",
"analitica": true,
"pai_codigo": "6.01.01.02",
"nivel": 5,
"codigo_antigo": "331",
"observacoes": "ESTÁ CORRETO A CLASSIFICAÇÃO"
},
{
"codigo": "6.01.01.02.00007",
"descricao": "Simples Nacional",
"analitica": true,
"pai_codigo": "6.01.01.02",
"nivel": 5,
"codigo_antigo": "326",
"observacoes": null
},
{
"codigo": "6.01.01.03",
"descricao": "RECEITAS FINANCEIRAS",
"analitica": false,
"pai_codigo": "6.01.01",
"nivel": 4,
"codigo_antigo": "333",
"observacoes": null
},
{
"codigo": "6.01.01.03.00001",
"descricao": "Juros / multas",
"analitica": true,
"pai_codigo": "6.01.01.03",
"nivel": 5,
"codigo_antigo": "362",
"observacoes": null
},
{
"codigo": "6.01.01.03.00002",
"descricao": "Juros ativos",
"analitica": true,
"pai_codigo": "6.01.01.03",
"nivel": 5,
"codigo_antigo": "334",
"observacoes": null
},
{
"codigo": "6.01.01.03.00003",
"descricao": "Multas",
"analitica": true,
"pai_codigo": "6.01.01.03",
"nivel": 5,
"codigo_antigo": "351",
"observacoes": null
},
{
"codigo": "6.01.01.03.00004",
"descricao": "Rendimentos de aplicações financeiras",
"analitica": true,
"pai_codigo": "6.01.01.03",
"nivel": 5,
"codigo_antigo": "335",
"observacoes": null
},
{
"codigo": "6.01.01.04",
"descricao": "RECEITAS DIVERSAS",
"analitica": false,
"pai_codigo": "6.01.01",
"nivel": 4,
"codigo_antigo": "336",
"observacoes": null
},
{
"codigo": "6.01.01.04.00001",
"descricao": "Entradas de brindes, amostras e bonificações",
"analitica": true,
"pai_codigo": "6.01.01.04",
"nivel": 5,
"codigo_antigo": "335",
"observacoes": null
},
{
"codigo": "6.01.01.04.00002",
"descricao": "Recuperação de despesas",
"analitica": true,
"pai_codigo": "6.01.01.04",
"nivel": 5,
"codigo_antigo": "337",
"observacoes": null
},
{
"codigo": "6.01.02",
"descricao": "RECEITAS NÃO OPERACIONAIS",
"analitica": false,
"pai_codigo": "6.01",
"nivel": 3,
"codigo_antigo": "338",
"observacoes": null
},
{
"codigo": "6.01.02.01",
"descricao": "RECEITAS DIVERSAS",
"analitica": false,
"pai_codigo": "6.01.02",
"nivel": 4,
"codigo_antigo": "339",
"observacoes": null
},
{
"codigo": "6.01.02.01.00001",
"descricao": "Descontos recebidos",
"analitica": true,
"pai_codigo": "6.01.02.01",
"nivel": 5,
"codigo_antigo": "354",
"observacoes": null
},
{
"codigo": "6.01.02.01.00002",
"descricao": "Ganhos de capital",
"analitica": true,
"pai_codigo": "6.01.02.01",
"nivel": 5,
"codigo_antigo": "340",
"observacoes": null
},
{
"codigo": "6.01.02.01.00003",
"descricao": "Outras receitas",
"analitica": true,
"pai_codigo": "6.01.02.01",
"nivel": 5,
"codigo_antigo": "341",
"observacoes": null
},
{
"codigo": "6.01.02.02",
"descricao": "Reembolso de adiantamento de viagens",
"analitica": true,
"pai_codigo": "6.01.02",
"nivel": 4,
"codigo_antigo": "401",
"observacoes": "É CLASSIFICADO COMO RECEITA INTERNAMENTE NA EMPRESA"
},
{
"codigo": "5",
"descricao": "CUSTOS E DESPESAS",
"analitica": false,
"pai_codigo": null,
"nivel": 1,
"codigo_antigo": "258",
"observacoes": null
},
{
"codigo": "5.01",
"descricao": "DESPESAS DIVERSAS",
"analitica": false,
"pai_codigo": "5",
"nivel": 2,
"codigo_antigo": "259",
"observacoes": null
},
{
"codigo": "5.01.01",
"descricao": "DESPESAS OPERACIONAIS",
"analitica": false,
"pai_codigo": "5.01",
"nivel": 3,
"codigo_antigo": "260",
"observacoes": null
},
{
"codigo": "5.01.01.01",
"descricao": "CUSTO DAS VENDAS",
"analitica": false,
"pai_codigo": "5.01.01",
"nivel": 4,
"codigo_antigo": "261",
"observacoes": null
},
{
"codigo": "5.01.01.01.01.01",
"descricao": "Custo das mercadorias vendidas (CMV)",
"analitica": true,
"pai_codigo": "5.01.01.01",
"nivel": 6,
"codigo_antigo": "262",
"observacoes": "•"
},
{
"codigo": "5.01.01.01.02.02",
"descricao": "Custo dos produtos vendidos",
"analitica": true,
"pai_codigo": "5.01.01.01",
"nivel": 6,
"codigo_antigo": "263",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03",
"descricao": "Custo dos serviços prestados",
"analitica": false,
"pai_codigo": "5.01.01.01",
"nivel": 6,
"codigo_antigo": "264",
"observacoes": "TEM QUE SER CONTA SINTETICA SOMENTO OS CUSTOS TOTAIS DOS SERVIÇOS"
},
{
"codigo": "5.01.01.01.03.03.001",
"descricao": "CUSTOS DE OBRAS (MATERIAIS)",
"analitica": false,
"pai_codigo": "5.01.01.01.03.03",
"nivel": 7,
"codigo_antigo": "280",
"observacoes": "CONTA SINTETICA COM O TOTAL DOS GASTOS COM COLABORADORES DAS OBRAS"
},
{
"codigo": "5.01.01.01.03.03.001.0001",
"descricao": "Compras de gás em obras",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "412",
"observacoes": "ESTAS CONTAS FORAM RECLASSIFICADAS, POR SE TRATAR DE CUSTOS OPERACIONAIS DAS OBRAS ( MATERIAIS, TRANSPORTES, TERCEIRIZAÇÃO, HOSPEDAGEM, ALIMENTAÇAÕ)"
},
{
"codigo": "5.01.01.01.03.03.001.0002",
"descricao": "Despesas c/ aluguéis de imóveis em obras",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "360",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0003",
"descricao": "Despesas com aluguel de imóveis",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "359",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0004",
"descricao": "Fretes e redespacho de mercadorias — Correios",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "389",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0005",
"descricao": "Hospedagem",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "368",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0006",
"descricao": "Locação de equipamentos diversos",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "391",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0007",
"descricao": "Materiais de consumo — obras em andamento",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "411",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0008",
"descricao": "Prestação de serviços de terceiros em obras",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "388",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0009",
"descricao": "Recolha de resíduos",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "376",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.001.0010",
"descricao": "Refeições",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.001",
"nivel": 8,
"codigo_antigo": "369",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.002",
"descricao": "Despesas de Veíclos",
"analitica": false,
"pai_codigo": "5.01.01.01.03.03",
"nivel": 7,
"codigo_antigo": "363",
"observacoes": "CONTA SINTETICA COM O TOTAL DOS GASTOS COM TRANSPORTE"
},
{
"codigo": "5.01.01.01.03.03.002.0001",
"descricao": "Combustíveis",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.002",
"nivel": 8,
"codigo_antigo": "364",
"observacoes": "ESTAS CONTAS FORAM RECLASSIFICADAS, POR SE TRATAR DE CUSTOS OPERACIONAIS DAS OBRAS"
},
{
"codigo": "5.01.01.01.03.03.002.0002",
"descricao": "IPVA",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.002",
"nivel": 8,
"codigo_antigo": "366",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.002.0003",
"descricao": "Locação de vans FCR",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.002",
"nivel": 8,
"codigo_antigo": "372",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.002.0004",
"descricao": "Locação de veículos",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.002",
"nivel": 8,
"codigo_antigo": "373",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.002.0006",
"descricao": "Manutenção de veículos",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.002",
"nivel": 8,
"codigo_antigo": "365",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.002.0007",
"descricao": "Pedágios",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.002",
"nivel": 8,
"codigo_antigo": "375",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.002.0008",
"descricao": "Seguros de veículos",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.002",
"nivel": 8,
"codigo_antigo": "367",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003",
"descricao": "DESPESAS COM PESSOAL",
"analitica": false,
"pai_codigo": "5.01.01.01.03.03",
"nivel": 7,
"codigo_antigo": "265",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0001",
"descricao": "13º salário",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "342",
"observacoes": "ESTAS CONTAS FORAM RECLASSIFICADAS, POR SE TRATAR DE CUSTOS COM PESSOAL"
},
{
"codigo": "5.01.01.01.03.03.003.0002",
"descricao": "Adiantamento de salários (empréstimos)",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "380",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0003",
"descricao": "Compra de passagens — ônibus",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "377",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0004",
"descricao": "Encargos sociais",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "267",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0005",
"descricao": "EPI em geral",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "390",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0006",
"descricao": "Exames admissionais",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "382",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0007",
"descricao": "Exames periódicos",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "382",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0008",
"descricao": "Férias",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "343",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0009",
"descricao": "FGTS",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "396",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0010",
"descricao": "Lavagem de roupas",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "400",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0011",
"descricao": "Plano de saúde",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "271",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0012",
"descricao": "Rescisões",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "381",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0013",
"descricao": "Salários",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "266",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0014",
"descricao": "Táxi ou Uber",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "394",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0015",
"descricao": "Uniformes",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "270",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0016",
"descricao": "Vale alimentação",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "268",
"observacoes": null
},
{
"codigo": "5.01.01.01.03.03.003.0017",
"descricao": "Vale prêmio",
"analitica": true,
"pai_codigo": "5.01.01.01.03.03.003",
"nivel": 8,
"codigo_antigo": "384",
"observacoes": null
},
{
"codigo": "5.01.01.03",
"descricao": "DESPESAS ADMINISTRATIVAS",
"analitica": false,
"pai_codigo": "5.01.01",
"nivel": 4,
"codigo_antigo": "272",
"observacoes": null
},
{
"codigo": "5.01.01.03.00001",
"descricao": "Aluguéis casa dos argentinos",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "408",
"observacoes": "DESPESAS ADMINISTRATIVAS  SUGERIDAS"
},
{
"codigo": "5.01.01.03.00002",
"descricao": "Compra de passagens aéreas",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "379",
"observacoes": null
},
{
"codigo": "5.01.01.03.00003",
"descricao": "Compra de produtos de limpeza — administrativo",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "404",
"observacoes": null
},
{
"codigo": "5.01.01.03.00005",
"descricao": "Despesas com comissões",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "285",
"observacoes": null
},
{
"codigo": "5.01.01.03.00006",
"descricao": "Despesas com software / sistemas",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "357",
"observacoes": null
},
{
"codigo": "5.01.01.03.00007",
"descricao": "Despesas com viagens",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "286",
"observacoes": null
},
{
"codigo": "5.01.01.03.00008",
"descricao": "Energia elétrica",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "361",
"observacoes": null
},
{
"codigo": "5.01.01.03.00009",
"descricao": "Fretes e carretos",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "284",
"observacoes": null
},
{
"codigo": "5.01.01.03.00010",
"descricao": "Gastos com brindes e doações",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "345",
"observacoes": null
},
{
"codigo": "5.01.01.03.00011",
"descricao": "Gastos com festividades",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "311",
"observacoes": null
},
{
"codigo": "5.01.01.03.00012",
"descricao": "Internet",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "385",
"observacoes": null
},
{
"codigo": "5.01.01.03.00017",
"descricao": "Multas de trânsito",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "309",
"observacoes": null
},
{
"codigo": "5.01.01.03.00013",
"descricao": "Manutenção elétrica de equipamentos",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "387",
"observacoes": null
},
{
"codigo": "5.01.01.03.00014",
"descricao": "Manutenção mecânica de equipamentos",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "386",
"observacoes": null
},
{
"codigo": "5.01.01.03.00015",
"descricao": "Material de consumo",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "280",
"observacoes": null
},
{
"codigo": "5.01.01.03.00016",
"descricao": "Material de expediente",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "281",
"observacoes": null
},
{
"codigo": "5.01.01.03.00018",
"descricao": "Prestação de serviços contábeis",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "356",
"observacoes": null
},
{
"codigo": "5.01.01.03.00019",
"descricao": "Prestação de serviços jurídicos",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "374",
"observacoes": null
},
{
"codigo": "5.01.01.03.00020",
"descricao": "Produtos químicos — lavação de veículos",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "395",
"observacoes": null
},
{
"codigo": "5.01.01.03.00021",
"descricao": "Pró-labore",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "273",
"observacoes": null
},
{
"codigo": "5.01.01.03.00022",
"descricao": "Propaganda e publicidade",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "409",
"observacoes": null
},
{
"codigo": "5.01.01.03.00023",
"descricao": "Taxas jurídicas e ambientais",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "403",
"observacoes": null
},
{
"codigo": "5.01.01.03.00024",
"descricao": "Telefone",
"analitica": true,
"pai_codigo": "5.01.01.03",
"nivel": 5,
"codigo_antigo": "277",
"observacoes": null
},
{
"codigo": "5.01.01.05",
"descricao": "DESPESAS TRIBUTÁRIAS",
"analitica": false,
"pai_codigo": "5.01.01",
"nivel": 4,
"codigo_antigo": null,
"observacoes": null
},
{
"codigo": "5.01.01.05.00001",
"descricao": "Impostos e taxas diversas",
"analitica": true,
"pai_codigo": "5.01.01.05",
"nivel": 5,
"codigo_antigo": "295",
"observacoes": "CONTAS DE DESPESAS TRIBUTÁRIAS SUGERIDAS"
},
{
"codigo": "5.01.01.05.00002",
"descricao": "IOF",
"analitica": true,
"pai_codigo": "5.01.01.05",
"nivel": 5,
"codigo_antigo": "290",
"observacoes": null
},
{
"codigo": "5.01.01.05.00003",
"descricao": "IPTU",
"analitica": true,
"pai_codigo": "5.01.01.05",
"nivel": 5,
"codigo_antigo": "288",
"observacoes": null
},
{
"codigo": "5.01.01.05.00004",
"descricao": "IRPJ",
"analitica": true,
"pai_codigo": "5.01.01.05",
"nivel": 5,
"codigo_antigo": "397",
"observacoes": null
},
{
"codigo": "5.01.01.05.00005",
"descricao": "Multas fiscais",
"analitica": true,
"pai_codigo": "5.01.01.05",
"nivel": 5,
"codigo_antigo": "291",
"observacoes": null
},
{
"codigo": "5.01.01.05.00006",
"descricao": "Cofibs",
"analitica": true,
"pai_codigo": "5.01.01.05",
"nivel": 5,
"codigo_antigo": "292",
"observacoes": null
},
{
"codigo": "5.01.01.05.00007",
"descricao": "Pis",
"analitica": true,
"pai_codigo": "5.01.01.05",
"nivel": 5,
"codigo_antigo": "293",
"observacoes": null
},
{
"codigo": "5.01.01.06",
"descricao": "DESPESAS FINANCEIRAS",
"analitica": false,
"pai_codigo": "5.01.01",
"nivel": 4,
"codigo_antigo": "296",
"observacoes": null
},
{
"codigo": "5.01.01.06.00001",
"descricao": "Avisos de débitos bancários",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "297",
"observacoes": "CONTAS DE DESPESAS FINANCEIRAS SUGERIDAS"
},
{
"codigo": "5.01.01.06.00002",
"descricao": "Descontos concedidos",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "299",
"observacoes": null
},
{
"codigo": "5.01.01.06.00003",
"descricao": "Juros antecipação de títulos",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "383",
"observacoes": null
},
{
"codigo": "5.01.01.06.00004",
"descricao": "Juros de mora",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "298",
"observacoes": null
},
{
"codigo": "5.01.01.06.00005",
"descricao": "Pagamentos parcelas contratos bancários",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "402",
"observacoes": null
},
{
"codigo": "5.01.01.06.00006",
"descricao": "Tarifas bancárias",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "279",
"observacoes": null
},
{
"codigo": "5.01.01.06.00007",
"descricao": "Variações cambiais passivas",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "300",
"observacoes": null
},
{
"codigo": "5.01.01.06.00008",
"descricao": "Variações monetárias passivas",
"analitica": true,
"pai_codigo": "5.01.01.06",
"nivel": 5,
"codigo_antigo": "301",
"observacoes": null
},
{
"codigo": "5.01.01.07",
"descricao": "DEPRECIAÇÕES E AMORTIZAÇÕES",
"analitica": false,
"pai_codigo": "5.01.01",
"nivel": 4,
"codigo_antigo": "302",
"observacoes": null
},
{
"codigo": "5.01.01.07.00001",
"descricao": "Depreciações",
"analitica": true,
"pai_codigo": "5.01.01.07",
"nivel": 5,
"codigo_antigo": "303",
"observacoes": null
},
{
"codigo": "5.01.01.07.00002",
"descricao": "Amortizações",
"analitica": true,
"pai_codigo": "5.01.01.07",
"nivel": 5,
"codigo_antigo": "304",
"observacoes": null
},
{
"codigo": "5.01.01.08",
"descricao": "PERDAS DIVERSAS",
"analitica": false,
"pai_codigo": "5.01.01",
"nivel": 4,
"codigo_antigo": "305",
"observacoes": null
},
{
"codigo": "5.01.01.08.00001",
"descricao": "Perdas por insolvência",
"analitica": true,
"pai_codigo": "5.01.01.08",
"nivel": 5,
"codigo_antigo": "306",
"observacoes": null
},
{
"codigo": "5.01.02",
"descricao": "DESPESAS NÃO OPERACIONAIS",
"analitica": false,
"pai_codigo": "5.01",
"nivel": 3,
"codigo_antigo": "307",
"observacoes": "•"
},
{
"codigo": "5.01.02.01",
"descricao": "DESPESAS DIVERSAS",
"analitica": false,
"pai_codigo": "5.01.02",
"nivel": 4,
"codigo_antigo": "308",
"observacoes": null
},
{
"codigo": "5.01.02.01.00001",
"descricao": "Outras Despesas (diveresas)",
"analitica": true,
"pai_codigo": "5.01.02.01",
"nivel": 5,
"codigo_antigo": "308",
"observacoes": null
},
{
"codigo": "5.01.02.02",
"descricao": "INVESTIMENTOS",
"analitica": false,
"pai_codigo": "5.01.02",
"nivel": 4,
"codigo_antigo": null,
"observacoes": null
},
{
"codigo": "5.01.02.02.00001",
"descricao": "Compra de equipamentos",
"analitica": true,
"pai_codigo": "5.01.02.02",
"nivel": 5,
"codigo_antigo": "392",
"observacoes": "GRUPO SUGERIDO PARA SEPARAR OS INVESTIMENTOS DAS DEMAIS CONTAS OPERACIONAIS"
},
{
"codigo": "5.01.02.02.00002",
"descricao": "Compra de máquinas",
"analitica": true,
"pai_codigo": "5.01.02.02",
"nivel": 5,
"codigo_antigo": "393",
"observacoes": null
},
{
"codigo": "5.01.02.02.00003",
"descricao": "Compra de móveis",
"analitica": true,
"pai_codigo": "5.01.02.02",
"nivel": 5,
"codigo_antigo": "396",
"observacoes": null
},
{
"codigo": "5.01.02.02.00004",
"descricao": "Compras de veículos",
"analitica": true,
"pai_codigo": "5.01.02.02",
"nivel": 5,
"codigo_antigo": "405",
"observacoes": null
},
{
"codigo": "5.01.02.02.00005",
"descricao": "Pagamentos de consórcios",
"analitica": true,
"pai_codigo": "5.01.02.02",
"nivel": 5,
"codigo_antigo": "397",
"observacoes": null
},
{
"codigo": "5.01.02.03",
"descricao": "OUTROS DESEMBOLSOS REALIZADOS",
"analitica": false,
"pai_codigo": "5.01.02",
"nivel": 4,
"codigo_antigo": null,
"observacoes": null
},
{
"codigo": "5.01.02.03.00001",
"descricao": "Desembolso Adiantamento de viagens",
"analitica": true,
"pai_codigo": "5.01.02.03",
"nivel": 5,
"codigo_antigo": "370",
"observacoes": "GRUPO SUGERIDO PARA SEPARAR O PAGTO DOS EMPRESTIMOS DAS CONTAS OPERACIONAIS - BEM COMO O DESEMBOLSO DAS DESPESAS COM VIAGENS"
},
{
"codigo": "5.01.02.03.00002",
"descricao": "Contratos bancários — liquidação de parcelas",
"analitica": true,
"pai_codigo": "5.01.02.03",
"nivel": 5,
"codigo_antigo": "407",
"observacoes": null
},
{
"codigo": "5.01.02.03.00003",
"descricao": "Pagto. parcelas contratos Banco do Brasil",
"analitica": true,
"pai_codigo": "5.01.02.03",
"nivel": 5,
"codigo_antigo": "398",
"observacoes": null
},
{
"codigo": "5.01.02.03.00004",
"descricao": "Pagto. parcelas contratos Sicredi",
"analitica": true,
"pai_codigo": "5.01.02.03",
"nivel": 5,
"codigo_antigo": "399",
"observacoes": null
},
{
"codigo": "5.01.02.03.00005",
"descricao": "Pagto. parcelas de financiamento de veículos",
"analitica": true,
"pai_codigo": "5.01.02.03",
"nivel": 5,
"codigo_antigo": "406",
"observacoes": null
},
{
"codigo": "5.01.02.04",
"descricao": "RETIRADA DE LUCROS ACUMULADOS",
"analitica": false,
"pai_codigo": "5.01.02",
"nivel": 4,
"codigo_antigo": "410",
"observacoes": null
},
{
"codigo": "5.01.02.04.00001",
"descricao": "Pagto de lucros e dividendos - Adriano",
"analitica": true,
"pai_codigo": "5.01.02.04",
"nivel": 5,
"codigo_antigo": "411",
"observacoes": "GRUPO SUGERIDO PARA ALOCAR OS PAGTOS DAS DISTRIBUIÇÕES DE LUCROS"
},
{
"codigo": "5.01.02.04.00002",
"descricao": "Pagto de lucros e dividendos - Cecom",
"analitica": true,
"pai_codigo": "5.01.02.04",
"nivel": 5,
"codigo_antigo": "412",
"observacoes": null
}
]$json$::jsonb) r
ON CONFLICT (company_id, codigo) DO UPDATE
  SET descricao = EXCLUDED.descricao, analitica = EXCLUDED.analitica, pai_codigo = EXCLUDED.pai_codigo,
      nivel = EXCLUDED.nivel, codigo_antigo = EXCLUDED.codigo_antigo, observacoes = EXCLUDED.observacoes,
      ativo = true, updated_at = now();

-- (3) psgc_depara das obras (gerencial 2.04.x → CMV 4.x). Sem isto, obra cairia em 6.11 (despesa).
INSERT INTO public.psgc_depara
  (company_id, origem_codigo, origem_descricao, origem_sistema, psgc_codigo, metodo, confianca, revisado, ativo)
SELECT 'b202b50f-37cb-462e-accf-126869de49f0'::uuid, t.cod, t.des, 'gerencial', t.psgc, 'import', 100, true, true
FROM (VALUES
  ('2.04.01', 'Materiais Aplicados em Obra',    '4.1'),
  ('2.04.02', 'Mão de Obra de Obra',            '4.3'),
  ('2.04.03', 'Veículos e Equipamentos de Obra','4.5'),
  ('2.04.04', 'Subempreitada',                  '4.4'),
  ('2.04.05', 'Medições de Obra',               '4.4')
) AS t(cod, des, psgc)
WHERE NOT EXISTS (
  SELECT 1 FROM public.psgc_depara d
  WHERE d.company_id = 'b202b50f-37cb-462e-accf-126869de49f0'::uuid AND d.origem_codigo = t.cod AND d.ativo
);
