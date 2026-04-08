import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo';

// ═══════════════════════════════════════════════
// DADOS REALISTAS — 12 MESES DE OPERAÇÃO
// ═══════════════════════════════════════════════

// Revenue per month (seasonality: Feb lowest, Nov peak)
const RECEITAS_MES: Record<string, number> = {
  "2025-05": 520000, "2025-06": 480000, "2025-07": 450000, "2025-08": 510000,
  "2025-09": 580000, "2025-10": 650000, "2025-11": 720000, "2025-12": 680000,
  "2026-01": 550000, "2026-02": 470000, "2026-03": 620000, "2026-04": 690000,
};

// Revenue split by business line
const LINHAS = [
  { nome: "Venda de Produtos", tipo: "Comércio", pct: 0.38, produtos: 120, pessoas: 12, catRec: "1.01.01", catCusto: "2.01.01", margem: 0.35 },
  { nome: "Consultoria Empresarial", tipo: "Serviço", pct: 0.25, produtos: 8, pessoas: 10, catRec: "1.02.01", catCusto: "2.02.01", margem: 0.55 },
  { nome: "Manutenção e Suporte", tipo: "Serviço", pct: 0.17, produtos: 15, pessoas: 8, catRec: "1.02.02", catCusto: "2.02.02", margem: 0.40 },
  { nome: "Treinamentos e Cursos", tipo: "Serviço", pct: 0.12, produtos: 6, pessoas: 5, catRec: "1.02.03", catCusto: "2.02.03", margem: 0.15 },
  { nome: "E-commerce", tipo: "Comércio", pct: 0.08, produtos: 85, pessoas: 4, catRec: "1.01.02", catCusto: "2.01.02", margem: -0.05 },
];

const CLIENTES = [
  "Construtora Horizonte Ltda","Tech Solutions Brasil S.A.","Grupo Alimentar Sul","Metalúrgica Progresso",
  "Rede Saúde Vida","Agro Cerrado S.A.","Transportadora Irmãos Silva","Supermercados Bom Preço",
  "Indústria Plásticos Delta","Escola Saber Mais","Hotel Estância Real","Farmácia Popular Plus",
  "Concessionária Auto Sul","Restaurante Sabor da Terra","Clínica Odonto Smile","Padaria Pão Quente",
  "Escritório Advocacia Lima","Imobiliária Centro Norte","Pet Shop Animal Feliz","Lavanderia Express Clean",
  "Distribuidora Bebidas Sol","Gráfica Print Master","Academia Corpo em Forma","Floricultura Jardim Belo",
  "Papelaria Escolar ABC","Ótica Visão Clara","Barbearia Corte Fino","Sorveteria Gelato Art",
  "Oficina Mecânica Elite","Consultório Dr. Marcos",
];

const FORNECEDORES = [
  "Distribuidora Nacional de Insumos","Logística Express Ltda","Fornecedor de Embalagens ABC",
  "Tecnologia e Equipamentos S.A.","Serviços de TI Pro","Aluguel Imobiliário Ltda",
  "Energia Elétrica S.A.","Águas Municipais","Agência MKT Digital","Contabilidade Certeza",
  "Seguros Proteção Total","Telefonia Móvel Brasil","Internet Fibra Plus","Viagens Corp Travel",
  "Material de Escritório Paper","Manutenção Predial Fix","Combustíveis Rede Posto","Gráfica Impressão Rápida",
];

const CATEGORIAS_FIXAS = [
  { codigo: "3.01.01", nome: "Salários e Encargos", valorBase: 125000, variacao: 0.05 },
  { codigo: "3.01.02", nome: "13º Salário e Férias (provisão)", valorBase: 15000, variacao: 0.02 },
  { codigo: "3.01.03", nome: "Benefícios (VT, VR, Plano Saúde)", valorBase: 22000, variacao: 0.03 },
  { codigo: "3.02.01", nome: "Aluguel e Condomínio", valorBase: 18500, variacao: 0.0 },
  { codigo: "3.02.02", nome: "IPTU e Taxas Municipais", valorBase: 2200, variacao: 0.0 },
  { codigo: "3.03.01", nome: "Energia Elétrica", valorBase: 4800, variacao: 0.15 },
  { codigo: "3.03.02", nome: "Água e Esgoto", valorBase: 1200, variacao: 0.10 },
  { codigo: "3.04.01", nome: "Marketing Digital (Google, Meta)", valorBase: 8500, variacao: 0.20 },
  { codigo: "3.04.02", nome: "Material Promocional", valorBase: 2500, variacao: 0.30 },
  { codigo: "3.05.01", nome: "Contabilidade e Assessoria", valorBase: 3800, variacao: 0.0 },
  { codigo: "3.05.02", nome: "Assessoria Jurídica", valorBase: 2000, variacao: 0.10 },
  { codigo: "3.06.01", nome: "Manutenção e Reparos", valorBase: 3200, variacao: 0.25 },
  { codigo: "3.07.01", nome: "Viagens e Deslocamentos", valorBase: 4500, variacao: 0.30 },
  { codigo: "3.08.01", nome: "Material de Escritório", valorBase: 1800, variacao: 0.15 },
  { codigo: "3.09.01", nome: "Telefone e Internet", valorBase: 2800, variacao: 0.05 },
  { codigo: "3.10.01", nome: "Seguros Diversos", valorBase: 3500, variacao: 0.0 },
  { codigo: "3.11.01", nome: "Depreciação de Equipamentos", valorBase: 4200, variacao: 0.0 },
  { codigo: "3.12.01", nome: "Software e Licenças", valorBase: 5600, variacao: 0.05 },
  { codigo: "4.01.01", nome: "Juros sobre Empréstimos", valorBase: 6800, variacao: 0.10 },
  { codigo: "4.01.02", nome: "Tarifas Bancárias", valorBase: 1500, variacao: 0.15 },
  { codigo: "4.02.01", nome: "IOF e Tributos Financeiros", valorBase: 900, variacao: 0.20 },
];

// Some months have no category (to trigger alerts)
const SEM_CATEGORIA = [
  { mes: "2026-01", valor: 12500, desc: "Pagamento diversos" },
  { mes: "2026-03", valor: 8700, desc: "Serviço avulso" },
  { mes: "2025-11", valor: 15300, desc: "Compra emergencial" },
];

function rand(base: number, variacao: number): number {
  return Math.round(base * (1 + (Math.random() * 2 - 1) * variacao));
}

function fmtDate(mes: string, dia: number): string {
  const [ano, m] = mes.split("-");
  return `${String(dia).padStart(2,"0")}/${m}/${ano}`;
}

function generateContasReceber(meses: string[]): any[] {
  const items: any[] = [];
  for (const mes of meses) {
    const recTotal = RECEITAS_MES[mes] || 550000;
    for (const linha of LINHAS) {
      const recLinha = Math.round(recTotal * linha.pct);
      // Split into 3-8 invoices per line per month
      const numFaturas = 3 + Math.floor(Math.random() * 6);
      let restante = recLinha;
      for (let i = 0; i < numFaturas; i++) {
        const valor = i === numFaturas - 1 ? restante : Math.round(restante * (0.1 + Math.random() * 0.3));
        restante -= valor;
        if (valor <= 0) continue;
        items.push({
          codigo_categoria: linha.catRec,
          categoria: `Receita - ${linha.nome}`,
          valor_documento: valor,
          data_vencimento: fmtDate(mes, 5 + Math.floor(Math.random() * 20)),
          nome_cliente: CLIENTES[Math.floor(Math.random() * CLIENTES.length)],
          status_titulo: Math.random() > 0.08 ? "LIQUIDADO" : "ABERTO",
          data_previsao: fmtDate(mes, 5 + Math.floor(Math.random() * 20)),
        });
      }
    }
  }
  return items;
}

function generateContasPagar(meses: string[]): any[] {
  const items: any[] = [];
  for (const mes of meses) {
    const recTotal = RECEITAS_MES[mes] || 550000;
    
    // Custos diretos por linha de negócio
    for (const linha of LINHAS) {
      const recLinha = Math.round(recTotal * linha.pct);
      const custoLinha = Math.round(recLinha * (1 - linha.margem));
      const numPagamentos = 2 + Math.floor(Math.random() * 4);
      let restante = custoLinha;
      for (let i = 0; i < numPagamentos; i++) {
        const valor = i === numPagamentos - 1 ? restante : Math.round(restante * (0.15 + Math.random() * 0.35));
        restante -= valor;
        if (valor <= 0) continue;
        items.push({
          codigo_categoria: linha.catCusto,
          categoria: `Custo Direto - ${linha.nome}`,
          valor_documento: valor,
          data_vencimento: fmtDate(mes, 1 + Math.floor(Math.random() * 25)),
          nome_fornecedor: FORNECEDORES[Math.floor(Math.random() * FORNECEDORES.length)],
          status_titulo: Math.random() > 0.06 ? "LIQUIDADO" : "ABERTO",
          data_previsao: fmtDate(mes, 1 + Math.floor(Math.random() * 25)),
        });
      }
    }

    // Custos fixos/administrativos
    for (const cat of CATEGORIAS_FIXAS) {
      items.push({
        codigo_categoria: cat.codigo,
        categoria: cat.nome,
        valor_documento: rand(cat.valorBase, cat.variacao),
        data_vencimento: fmtDate(mes, cat.codigo.includes("3.02") ? 5 : (1 + Math.floor(Math.random() * 25))),
        nome_fornecedor: FORNECEDORES[Math.floor(Math.random() * FORNECEDORES.length)],
        status_titulo: "LIQUIDADO",
        data_previsao: fmtDate(mes, 5 + Math.floor(Math.random() * 15)),
      });
    }

    // Lançamentos sem categoria (para mostrar alertas)
    const semCat = SEM_CATEGORIA.find(s => s.mes === mes);
    if (semCat) {
      items.push({
        codigo_categoria: "",
        categoria: "",
        valor_documento: semCat.valor,
        data_vencimento: fmtDate(mes, 15),
        nome_fornecedor: semCat.desc,
        status_titulo: "LIQUIDADO",
      });
    }
  }
  return items;
}

function generateCategorias(): any[] {
  const cats: any[] = [];
  const all = [
    { codigo: "1.01.01", descricao: "Receita de Vendas de Produtos" },
    { codigo: "1.01.02", descricao: "Receita E-commerce" },
    { codigo: "1.02.01", descricao: "Receita de Consultoria" },
    { codigo: "1.02.02", descricao: "Receita de Manutenção e Suporte" },
    { codigo: "1.02.03", descricao: "Receita de Treinamentos" },
    { codigo: "2.01.01", descricao: "CMV - Custo de Mercadorias Vendidas" },
    { codigo: "2.01.02", descricao: "CMV - E-commerce" },
    { codigo: "2.02.01", descricao: "Custo de Consultoria" },
    { codigo: "2.02.02", descricao: "Custo de Manutenção" },
    { codigo: "2.02.03", descricao: "Custo de Treinamentos" },
    ...CATEGORIAS_FIXAS.map(c => ({ codigo: c.codigo, descricao: c.nome })),
  ];
  for (const c of all) cats.push({ codigo: c.codigo, descricao: c.descricao, id: Math.floor(Math.random() * 999999) });
  return cats;
}

function generateClientes(): any[] {
  return CLIENTES.map((nome, i) => ({
    codigo_cliente: 1000 + i,
    razao_social: nome,
    nome_fantasia: nome,
    cnpj_cpf: `${String(10+i).padStart(2,"0")}.${String(100+i*3)}.${String(200+i*7)}/0001-${String(10+i)}`,
    cidade: ["Chapecó","São Miguel do Oeste","Xanxerê","Maravilha","Pinhalzinho","Concórdia"][i%6],
    estado: "SC",
    telefone: `(49) 3${String(300+i*7).padStart(3,"0")}-${String(1000+i*13)}`,
    email: `contato@${nome.toLowerCase().replace(/[^a-z]/g,"").substring(0,12)}.com.br`,
  }));
}

function generateProdutos(): any[] {
  const prods = [
    "Consultoria Estratégica","Diagnóstico Empresarial","Plano de Ação 360","Análise Financeira",
    "Software ERP Básico","Software ERP Premium","Treinamento Gestão","Treinamento Financeiro",
    "Suporte Técnico Mensal","Manutenção Preventiva","Kit Material Escritório","Equipamento TI",
    "Licença Software Anual","Serviço de Implantação","Consultoria Tributária","Auditoria Interna",
  ];
  return prods.map((nome, i) => ({
    codigo: 100 + i,
    descricao: nome,
    valor_unitario: [15000,12000,8000,6000,2500,4500,3000,2000,1800,2200,350,4800,1200,9500,7000,5500][i],
    unidade: i < 10 ? "SV" : "UN",
    ncm: "00000000",
    estoque: i >= 10 ? Math.floor(Math.random() * 100) + 5 : 0,
  }));
}

// ═══════════════════════════════════════════════
// API HANDLER
// ═══════════════════════════════════════════════

export async function GET(req: NextRequest) { return handleSeed(); }
export async function POST(req: NextRequest) { return handleSeed(); }

async function handleSeed() {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const MESES = Object.keys(RECEITAS_MES);

    // 1. Create demo company
    const { data: company, error: compErr } = await supabase.from("companies").upsert({
      razao_social: "PS Demo Comércio e Serviços Ltda",
      nome_fantasia: "✦ Empresa Demonstração",
      cnpj: "00.000.000/0001-00",
      cidade_estado: "Chapecó/SC",
      setor: "Comércio e Serviços",
      num_colaboradores: 45,
      faturamento_anual: 7200000,
      pais: "Brasil",
      moeda: "BRL",
      regime_tributario: "presumido",
      tipo_empresa: "matriz",
    }, { onConflict: "cnpj" }).select().single();

    if (compErr) {
      // Try insert without upsert
      const { data: c2, error: e2 } = await supabase.from("companies").insert({
        razao_social: "PS Demo Comércio e Serviços Ltda",
        nome_fantasia: "✦ Empresa Demonstração",
        cnpj: "00.000.000/0001-00",
        cidade_estado: "Chapecó/SC",
        setor: "Comércio e Serviços",
        num_colaboradores: 45,
        faturamento_anual: 7200000,
        pais: "Brasil",
        moeda: "BRL",
        regime_tributario: "presumido",
        tipo_empresa: "matriz",
      }).select().single();
      if (e2) return NextResponse.json({ error: "Erro criando empresa: " + e2.message }, { status: 500 });
      var companyId = c2.id;
    } else {
      var companyId = company.id;
    }

    // 2. Delete old demo data
    await supabase.from("omie_imports").delete().eq("company_id", companyId);
    await supabase.from("business_lines").delete().eq("company_id", companyId);
    await supabase.from("business_line_config").delete().eq("company_id", companyId);
    await supabase.from("orcamento").delete().eq("company_id", companyId);

    // 3. Create business lines
    for (const linha of LINHAS) {
      const { data: bl } = await supabase.from("business_lines").insert({
        company_id: companyId, nome: linha.nome, tipo: linha.tipo,
        produtos: linha.produtos, pessoas: linha.pessoas,
      }).select().single();

      // Create config per month
      if (bl) {
        for (const mes of MESES) {
          const recTotal = RECEITAS_MES[mes] || 550000;
          const recLinha = Math.round(recTotal * linha.pct);
          const custoLinha = Math.round(recLinha * (1 - linha.margem));
          await supabase.from("business_line_config").insert({
            company_id: companyId, line_id: bl.id, mes,
            faturamento: recLinha,
            impostos: Math.round(recLinha * 0.065),
            custos_diretos: custoLinha,
            custo_pessoal: Math.round(custoLinha * 0.35),
            rateio_pct: linha.pct * 100,
          });
        }
      }
    }

    // 4. Generate and insert omie_imports
    const contasReceber = generateContasReceber(MESES);
    const contasPagar = generateContasPagar(MESES);
    const categorias = generateCategorias();
    const clientes = generateClientes();
    const produtos = generateProdutos();

    const imports = [
      { import_type: "categorias", import_data: categorias, record_count: categorias.length },
      { import_type: "clientes", import_data: clientes, record_count: clientes.length },
      { import_type: "produtos", import_data: produtos, record_count: produtos.length },
      { import_type: "contas_pagar", import_data: contasPagar, record_count: contasPagar.length },
      { import_type: "contas_receber", import_data: contasReceber, record_count: contasReceber.length },
      { import_type: "vendas", import_data: [], record_count: 0 },
      { import_type: "estoque", import_data: produtos.filter(p => p.estoque > 0), record_count: produtos.filter(p => p.estoque > 0).length },
      { import_type: "resumo", import_data: {}, record_count: 0 },
      { import_type: "empresa", import_data: { razao_social: "PS Demo Comércio e Serviços Ltda", cnpj: "00.000.000/0001-00" }, record_count: 1 },
    ];

    for (const imp of imports) {
      await supabase.from("omie_imports").insert({
        company_id: companyId,
        import_type: imp.import_type,
        import_data: imp.import_data,
        record_count: imp.record_count,
      });
    }

    // 5. Create budget (orçamento)
    for (const mes of MESES) {
      const recTotal = RECEITAS_MES[mes] || 550000;
      // Revenue budget (5% above actual for realistic variance)
      for (const linha of LINHAS) {
        await supabase.from("orcamento").insert({
          company_id: companyId, mes,
          categoria: `Receita - ${linha.nome}`,
          valor: Math.round(recTotal * linha.pct * 1.05),
          tipo: "receita",
        });
      }
      // Expense budget
      for (const cat of CATEGORIAS_FIXAS) {
        await supabase.from("orcamento").insert({
          company_id: companyId, mes,
          categoria: cat.nome,
          valor: Math.round(cat.valorBase * 0.98),
          tipo: "despesa",
        });
      }
    }

    // Summary
    const totalRec = contasReceber.reduce((s, c) => s + c.valor_documento, 0);
    const totalPag = contasPagar.reduce((s, c) => s + c.valor_documento, 0);

    return NextResponse.json({
      success: true,
      company_id: companyId,
      resumo: {
        empresa: "✦ Empresa Demonstração",
        meses: MESES.length,
        linhas_negocio: LINHAS.length,
        contas_receber: contasReceber.length,
        contas_pagar: contasPagar.length,
        categorias: categorias.length,
        clientes: clientes.length,
        produtos: produtos.length,
        receita_total: totalRec,
        despesa_total: totalPag,
        resultado: totalRec - totalPag,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
