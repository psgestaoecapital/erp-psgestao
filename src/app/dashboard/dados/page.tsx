"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0F0F0D",BG2="#1C1B18",BG3="#2A2822",
    G="#22C55E",R="#EF4444",Y="#FACC15",B="#3B82F6",
    BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#918C82";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

const Input=({label,value,onChange,type="text",placeholder="",prefix="",small=false}:any)=>(
  <div style={{marginBottom:small?8:12}}>
    <label style={{fontSize:11,color:TXM,display:"block",marginBottom:4}}>{label}</label>
    <div style={{display:"flex",alignItems:"center",gap:0}}>
      {prefix&&<span style={{background:BG3,border:`1px solid ${BD}`,borderRight:"none",borderRadius:"6px 0 0 6px",padding:"8px 10px",fontSize:12,color:TXD}}>{prefix}</span>}
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:prefix?"0 6px 6px 0":"6px",padding:"8px 10px",fontSize:12,width:"100%"}}/>
    </div>
  </div>
);

const Select=({label,value,onChange,options}:any)=>(
  <div style={{marginBottom:12}}>
    <label style={{fontSize:11,color:TXM,display:"block",marginBottom:4}}>{label}</label>
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,width:"100%"}}>
      {options.map((o:any)=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const Card=({children,title}:{children:React.ReactNode,title?:string})=>(
  <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:12,border:`0.5px solid ${BD}`}}>
    {title&&<div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
      <div style={{width:3,height:14,background:GO,borderRadius:2}}/>{title}
    </div>}
    {children}
  </div>
);

const Btn=({children,onClick,cor=GO,disabled=false}:any)=>(
  <button onClick={onClick} disabled={disabled} style={{
    padding:"10px 20px",borderRadius:8,border:"none",
    background:disabled?BD:`linear-gradient(135deg,${cor} 0%,${cor}CC 100%)`,
    color:disabled?TXD:cor===GO?"#0F0F0D":"white",fontSize:12,fontWeight:600,cursor:disabled?"default":"pointer"
  }}>{children}</button>
);

const Toast=({msg,tipo}:{msg:string,tipo:"ok"|"err"})=>(
  <div style={{position:"fixed",top:80,right:20,background:tipo==="ok"?G:R,color:"white",padding:"10px 20px",borderRadius:8,fontSize:12,fontWeight:600,zIndex:999,boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>{msg}</div>
);

// Dynamic months - from Jan 2020 to Dec 2030
const MESES: {value:string,label:string}[] = [];
const MESES_NOMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
for(let y=2025;y>=2020;y--) for(let m=y===2025?12:12;m>=1;m--) MESES.push({value:`${y}-${String(m).padStart(2,"0")}`,label:`${MESES_NOMES[m-1]} ${y}`});
for(let y=2026;y<=2030;y++) for(let m=1;m<=12;m++) MESES.unshift({value:`${y}-${String(m).padStart(2,"0")}`,label:`${MESES_NOMES[m-1]} ${y}`});
// Sort descending (most recent first)
MESES.sort((a,b)=>b.value.localeCompare(a.value));

// Master cost accounts organized by group
const CONTAS_CUSTO = [
  {grupo:"Pessoas",cor:"#3B82F6",contas:[
    {id:"prolabore",nome:"Pró-labore dos sócios",desc:"Valor mensal fixo retirado pelos sócios como remuneração. Não confundir com lucro distribuído."},
    {id:"folha_adm",nome:"Salários administrativos",desc:"Soma dos salários brutos da equipe administrativa: recepção, financeiro, RH, compras, gerência — quem NÃO trabalha diretamente na operação."},
    {id:"encargos",nome:"Encargos (INSS, FGTS)",desc:"INSS patronal + FGTS sobre toda a folha administrativa. Geralmente entre 28% e 36% do salário bruto."},
    {id:"vr_va",nome:"Vale refeição / alimentação",desc:"Valor mensal pago em cartão alimentação ou refeição para toda a equipe administrativa."},
    {id:"vt",nome:"Vale transporte",desc:"Custo líquido do VT (valor pago pela empresa menos o desconto de 6% do salário do colaborador)."},
    {id:"plano_saude",nome:"Plano de saúde",desc:"Valor mensal do plano de saúde empresarial para a equipe administrativa. Inclui dependentes se a empresa pagar."},
    {id:"seguro_vida",nome:"Seguro de vida em grupo",desc:"Apólice de seguro de vida coletivo contratada pela empresa. Pode ser obrigatório em alguns sindicatos."},
    {id:"treinamentos",nome:"Treinamentos e capacitação",desc:"Cursos, workshops, palestras e certificações pagos pela empresa para a equipe."},
    {id:"uniformes_epi",nome:"Uniformes / EPIs",desc:"Compra de uniformes, camisetas, EPIs (equipamentos de proteção individual). Rateie o valor anual por 12."},
    {id:"ferias_13",nome:"Provisão férias e 13º",desc:"Reserve 1/12 da folha mensal para férias e 1/12 para 13º. Assim o custo fica distribuído durante o ano."},
  ]},
  {grupo:"Ocupação",cor:"#A855F7",contas:[
    {id:"aluguel",nome:"Aluguel",desc:"Valor mensal do aluguel do imóvel onde a empresa funciona (escritório, loja, galpão). Se for próprio, coloque zero."},
    {id:"condominio",nome:"Condomínio",desc:"Taxa de condomínio mensal, se o imóvel for em prédio comercial ou condomínio empresarial."},
    {id:"iptu",nome:"IPTU",desc:"Imposto sobre o imóvel. Se pagar anual, divida por 12 para ter o valor mensal."},
    {id:"energia",nome:"Energia elétrica",desc:"Conta de luz do mês da sede/loja. Se tiver mais de um ponto, some todos."},
    {id:"agua",nome:"Água / esgoto",desc:"Conta de água e esgoto mensal do imóvel."},
    {id:"manut_predial",nome:"Manutenção predial",desc:"Reparos no imóvel: pintura, elétrica, hidráulica, ar condicionado, limpeza de caixa d'água, etc."},
    {id:"limpeza",nome:"Limpeza",desc:"Serviço de limpeza terceirizado ou material de limpeza. Se tiver funcionário próprio, inclua na folha."},
    {id:"seguranca_monit",nome:"Segurança / monitoramento",desc:"Empresa de vigilância, alarme monitorado, câmeras, cerca elétrica. Mensalidade do serviço."},
  ]},
  {grupo:"Veículos e Deslocamento",cor:"#14B8A6",contas:[
    {id:"combustivel",nome:"Combustível",desc:"Gasto mensal com combustível de TODOS os veículos da empresa (não inclua veículos pessoais dos sócios)."},
    {id:"manutencao_veic",nome:"Manutenção / revisões veículos",desc:"Troca de óleo, pneus, revisões, consertos. Se fizer revisão anual, divida por 12."},
    {id:"seguro_veic",nome:"Seguro veicular",desc:"Parcela mensal do seguro de cada veículo. Se pagar anual, divida por 12."},
    {id:"ipva_licenc",nome:"IPVA / licenciamento",desc:"IPVA + licenciamento anual dividido por 12 para ter o custo mensal."},
    {id:"pedagio_estac",nome:"Pedágio / estacionamento",desc:"Gastos mensais com pedágio em viagens e estacionamento em visitas a clientes."},
    {id:"leasing_veic",nome:"Leasing / parcelas veículos",desc:"Parcelas de financiamento ou leasing de veículos da empresa."},
  ]},
  {grupo:"Tecnologia e Comunicação",cor:"#F97316",contas:[
    {id:"internet",nome:"Internet / telefonia",desc:"Plano de internet da empresa + linhas telefônicas fixas e celulares corporativos."},
    {id:"softwares",nome:"Softwares e sistemas (ERP, CRM)",desc:"Mensalidade do ERP (Omie, ContaAzul, Bling), CRM, e-mail corporativo, antivírus, Office 365, etc."},
    {id:"hospedagem",nome:"Hospedagem / domínio web",desc:"Hospedagem do site, registro de domínio, certificado SSL, Google Workspace ou similares."},
    {id:"equip_ti",nome:"Equipamentos de TI",desc:"Compra ou aluguel de computadores, impressoras, servidores, nobreaks. Se comprou, divida a vida útil em meses."},
    {id:"suporte_ti",nome:"Suporte técnico",desc:"Mensalidade de empresa de TI terceirizada que dá suporte ao dia a dia (rede, backup, e-mail, ERP)."},
  ]},
  {grupo:"Administrativo e Assessorias",cor:"#C6973F",contas:[
    {id:"contabilidade",nome:"Contabilidade",desc:"Honorários mensais do escritório de contabilidade: balancete, SPED, DCTF, folha, obrigações acessórias."},
    {id:"juridico",nome:"Assessoria jurídica",desc:"Honorários de advogado ou escritório jurídico: contratos, trabalhista, tributário, societário."},
    {id:"financeiro_assess",nome:"Assessoria financeira",desc:"Consultoria ou assessoria financeira/empresarial contratada (ex: PS Gestão e Capital)."},
    {id:"despachante",nome:"Despachante / cartório",desc:"Despachante para documentos de veículos, certidões, registros em cartório, junta comercial."},
    {id:"material_escrit",nome:"Material de escritório",desc:"Papel, toner, canetas, pastas, grampeadores e materiais de expediente em geral."},
    {id:"correios",nome:"Correios / entregas",desc:"Envio de correspondências, documentos, contratos. Motoboy ou transportadora para documentos."},
  ]},
  {grupo:"Comercial e Marketing",cor:"#22C55E",contas:[
    {id:"marketing_inst",nome:"Marketing institucional",desc:"Ações de marca: banners, fachada, uniformes com logo, material gráfico, brindes institucionais."},
    {id:"marketing_digital",nome:"Marketing digital",desc:"Google Ads, Meta Ads (Facebook/Instagram), agência de marketing, gestão de redes sociais."},
    {id:"taxas_cartao",nome:"Taxas de cartão de crédito/débito",desc:"Percentual cobrado pela maquininha (Stone, PagSeguro, Cielo) sobre vendas no cartão. Veja o extrato da adquirente."},
    {id:"comissoes_banc",nome:"Comissões bancárias",desc:"Taxas de boleto, TED, PIX corporativo, manutenção de conta. Veja o extrato bancário mensal."},
    {id:"brindes",nome:"Brindes / amostras",desc:"Brindes para clientes, amostras de produtos, kits de presentes corporativos."},
    {id:"feiras_eventos",nome:"Feiras / eventos",desc:"Participação em feiras, exposições, congressos. Inclui estande, inscrição, deslocamento e hospedagem."},
    {id:"viagens_comerc",nome:"Viagens comerciais",desc:"Passagens, hospedagem e alimentação em viagens de trabalho para visitar clientes ou fornecedores."},
  ]},
  {grupo:"Financeiro",cor:"#EF4444",contas:[
    {id:"juros_emprest",nome:"Juros de empréstimos",desc:"Juros pagos sobre empréstimos bancários (BNDES, capital de giro, cheque especial). Somente os juros, não a amortização."},
    {id:"parcelas_financ",nome:"Parcelas de financiamento",desc:"Parcelas de financiamento de equipamentos, máquinas ou veículos. Inclui juros + amortização."},
    {id:"parcelas_consorcio",nome:"Parcelas de consórcio",desc:"Parcelas mensais de consórcio de veículos, imóveis ou equipamentos."},
    {id:"tarifas_banc",nome:"Tarifas bancárias",desc:"Tarifas de manutenção de conta, pacote de serviços, anuidade de cartão corporativo."},
    {id:"multas_juros",nome:"Multas / juros por atraso",desc:"Multas e juros pagos por atraso em contas, impostos ou fornecedores. Ideal que seja ZERO."},
  ]},
  {grupo:"Seguros",cor:"#FACC15",contas:[
    {id:"seguros",nome:"Seguro empresarial",desc:"Seguro do imóvel, conteúdo e lucros cessantes. Protege contra incêndio, roubo e desastres naturais."},
    {id:"seguro_rc",nome:"Seguro RC profissional",desc:"Responsabilidade Civil Profissional — cobre danos causados a terceiros pela atividade da empresa."},
    {id:"seguro_estoque",nome:"Seguro de estoque / mercadorias",desc:"Seguro sobre mercadorias armazenadas ou em trânsito. Importante para distribuidoras e comércio."},
  ]},
  {grupo:"Outros",cor:"#A8A498",contas:[
    {id:"depreciacao",nome:"Depreciação de equipamentos",desc:"Perda de valor dos equipamentos pelo uso. Divida o valor do bem pela vida útil em meses. Ex: máquina de R$ 60K com vida de 60 meses = R$ 1K/mês."},
    {id:"perdas_quebras",nome:"Perdas e quebras",desc:"Mercadorias perdidas, danificadas, vencidas ou furtadas no mês. Apure pelo inventário."},
    {id:"doacoes",nome:"Doações / patrocínios",desc:"Doações para instituições, patrocínios de eventos esportivos ou culturais, apoio a projetos sociais."},
    {id:"retiradas_extras",nome:"Retiradas extras dos sócios",desc:"Valores retirados pelos sócios ALÉM do pró-labore: uso do cartão da empresa, compras pessoais, sangrias de caixa."},
    {id:"outros",nome:"Outros custos diversos",desc:"Qualquer custo que não se encaixa nas categorias acima. Detalhe no campo personalizado se for relevante."},
  ]},
];

export default function DadosPage() {
  const [aba, setAba] = useState("empresa");
  const [toast, setToast] = useState<{msg:string,tipo:"ok"|"err"}|null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [groups, setGroups] = useState<any[]>([]);

  // Save to localStorage when changing
  useEffect(()=>{
    if(selectedCompany&&typeof window!=="undefined"){
      localStorage.setItem("ps_empresa_sel",selectedCompany);
    }
  },[selectedCompany]);
  const [mesSel, setMesSel] = useState("2025-01");

  // M0 - Empresa
  const [empresa, setEmpresa] = useState({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:"",setor:"",num_colaboradores:"",faturamento_anual:"",pais:"Brasil",moeda:"BRL",regime_tributario:"simples",tipo_empresa:"matriz",id_fiscal_exterior:""});
  
  // Business Lines
  const [linhas, setLinhas] = useState<any[]>([{nome:"",tipo:"comercio",responsavel:""}]);

  // M2 - Resultado por negócio (array, one per business line)
  const [resultado, setResultado] = useState<any[]>([]);

  // M3 - Custos Estrutura (flexible - key=account_id, value=amount)
  const [custos, setCustos] = useState<Record<string,string>>({});
  const [custosAtivos, setCustosAtivos] = useState<Record<string,boolean>>(()=>{
    // Default active accounts (most common)
    const defaults: Record<string,boolean> = {};
    ["prolabore","folha_adm","encargos","vr_va","aluguel","energia","internet","combustivel","contabilidade","marketing_inst","taxas_cartao","seguros","depreciacao","outros"].forEach(id=>defaults[id]=true);
    return defaults;
  });
  const [custosCustom, setCustosCustom] = useState<{nome:string,valor:string}[]>([]);
  const [mostrarTodos, setMostrarTodos] = useState(false);

  // Omie / ContaAzul Integration
  const [omieKey, setOmieKey] = useState("");
  const [omieSecret, setOmieSecret] = useState("");
  const [omieStatus, setOmieStatus] = useState<"idle"|"syncing"|"success"|"error">("idle");
  const [omieResult, setOmieResult] = useState<any>(null);
  const [omieErp, setOmieErp] = useState("omie");
  const [caToken, setCaToken] = useState("");
  const [caClientId, setCaClientId] = useState("");
  const [caClientSecret, setCaClientSecret] = useState("");

  // Handle ContaAzul OAuth callback params
  useEffect(()=>{
    if(typeof window !== "undefined"){
      const params = new URLSearchParams(window.location.search);
      const token = params.get("ca_token");
      const error = params.get("ca_error");
      if(token){ setCaToken(token); setOmieErp("contaazul"); }
      if(error){ setOmieErp("contaazul"); setOmieStatus("error"); setOmieResult({error:`Erro na autorização: ${error}`}); }
      // Clean URL params
      if(token || error){ window.history.replaceState({}, "", window.location.pathname); }
    }
  },[]);

  // Plano de Ação
  const [acoes, setAcoes] = useState<any[]>([]);
  const [novaAcao, setNovaAcao] = useState({acao:"",responsavel:"",prazo:"",prioridade:"media",categoria:"operacional",impacto_esperado:"",observacoes:""});
  const [loadingAcoes, setLoadingAcoes] = useState(false);

  // Data Alerts
  const [alertas, setAlertas] = useState<any[]>([]);
  const [alertaAberto, setAlertaAberto] = useState<number|null>(null);

  // Contexto Humano (Bloco 18)
  const [contexto, setContexto] = useState({
    problemas:"",mudancas_mercado:"",decisoes_pendentes:"",oportunidades:"",
    problemas_clientes:"",metas_sonhos:"",observacoes:""
  });

  useEffect(()=>{ loadCompanies(); }, []);

  const loadCompanies = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();
    const [{ data: grps }] = await Promise.all([
      supabase.from("company_groups").select("*").order("nome"),
    ]);
    setGroups(grps || []);

    // Load companies (RLS no banco filtra)
    const { data: companyData } = await supabase.from("companies").select("*").order("created_at", { ascending: false });

    if (companyData && companyData.length > 0) {
      setCompanies(companyData);
      const saved = typeof window !== "undefined" ? localStorage.getItem("ps_empresa_sel") : "";
      let targetComp = companyData[0];
      if (saved) {
        if (saved.startsWith("group_")) {
          const gid = saved.replace("group_", "");
          const match = companyData.find(c => c.group_id === gid);
          if (match) targetComp = match;
        } else if (saved !== "consolidado") {
          const match = companyData.find(c => c.id === saved);
          if (match) targetComp = match;
        }
      }
      setSelectedCompany(targetComp.id);
      setEmpresa({
        razao_social: targetComp.razao_social || "",
        nome_fantasia: targetComp.nome_fantasia || "",
        cnpj: targetComp.cnpj || "",
        cidade_estado: targetComp.cidade_estado || "",
        setor: targetComp.setor || "",
        num_colaboradores: targetComp.num_colaboradores?.toString() || "",
        faturamento_anual: targetComp.faturamento_anual?.toString() || "",
        pais: targetComp.pais || "Brasil",
        moeda: targetComp.moeda || "BRL",
        regime_tributario: targetComp.regime_tributario || "simples",
        tipo_empresa: targetComp.tipo_empresa || "matriz",
        id_fiscal_exterior: targetComp.id_fiscal_exterior || "",
      });
      loadBusinessLines(targetComp.id);
      setOmieKey(targetComp.omie_app_key||"");setOmieSecret(targetComp.omie_app_secret||"");
      if(targetComp.omie_app_key)setOmieErp("omie");
    }
  };

  const loadBusinessLines = async (compId: string) => {
    const { data } = await supabase.from("business_lines").select("*").eq("company_id", compId).order("created_at");
    if(data && data.length > 0) {
      setLinhas(data.map(d=>({id:d.id,nome:d.name,tipo:d.type||"comercio",responsavel:d.responsible||""})));
      setResultado(data.map(d=>({ln_id:d.id,ln_nome:d.name,faturamento_bruto:"",devolucoes:"",custo_produtos:"",mao_obra_direta:"",frete:"",comissoes:"",terceiros:"",marketing_direto:"",num_clientes:"",ticket_medio:""})));
    } else {
      setLinhas([{nome:"",tipo:"comercio",responsavel:""}]);
      setResultado([]);
    }
    // Load plano de ação
    const { data: acoesData } = await supabase.from("plano_acao").select("*").eq("company_id", compId).order("created_at",{ascending:false});
    setAcoes(acoesData || []);
    // Generate data alerts
    generateAlerts(compId);
  };

  const generateAlerts = async (compId: string) => {
    const alerts: any[] = [];
    const { data: imports } = await supabase.from("omie_imports").select("import_type,import_data,record_count").eq("company_id", compId);
    if(!imports || imports.length === 0) {
      alerts.push({tipo:"sem_dados",severidade:"critico",mensagem:"Nenhum dado importado do Omie",detalhe:"Esta empresa não tem dados financeiros. Conecte o Omie na aba Integrações.",sugestao:"Vá em ⚡ Integrações → Omie → Importar Dados",itens:[]});
    } else {
      // 1. Check empréstimos classificados como receita — com detalhes
      const recImports = imports.filter(i=>i.import_type==="contas_receber");
      const empItens: any[] = [];
      for(const cr of recImports){
        const regs = cr.import_data?.conta_receber_cadastro || [];
        if(!Array.isArray(regs)) continue;
        for(const r of regs){
          const cat = r.codigo_categoria || "";
          if(cat.startsWith("2.") || cat.startsWith("4.") || cat.startsWith("5.")) {
            empItens.push({
              data: r.data_emissao || r.data_vencimento || "—",
              doc: r.numero_documento || r.numero_documento_fiscal || "—",
              valor: Number(r.valor_documento) || 0,
              categoria_atual: `${cat} — ${r.descricao_categoria || "Sem descrição"}`,
              status: r.status_titulo || "—",
              onde_corrigir: "Omie → Contas a Receber → Localizar pelo documento → Alterar categoria para 1.xx (Receita Operacional) ou reclassificar como Empréstimo/Aporte",
            });
          }
        }
      }
      if(empItens.length > 0) {
        const total = empItens.reduce((s,i) => s + i.valor, 0);
        alerts.push({tipo:"classificacao",severidade:"atencao",
          mensagem:`${empItens.length} lançamentos (${fmtR(total)}) podem estar classificados incorretamente`,
          detalhe:`Contas a receber com categorias 2.xx, 4.xx ou 5.xx não são receita operacional. São empréstimos, aportes ou transferências que inflam o faturamento real.`,
          sugestao:"Corrija no Omie: reclassifique para categoria correta ou mova para módulo de Empréstimos.",
          itens: empItens.slice(0, 20),
        });
      }

      // 2. Contas sem categoria
      const semCatItens: any[] = [];
      for(const cr of recImports){
        const regs = cr.import_data?.conta_receber_cadastro || [];
        if(!Array.isArray(regs)) continue;
        for(const r of regs){
          const cat = r.codigo_categoria || "";
          if(!cat || cat === "sem_cat" || cat === "0") {
            semCatItens.push({
              data: r.data_emissao || r.data_vencimento || "—",
              doc: r.numero_documento || r.numero_documento_fiscal || "—",
              valor: Number(r.valor_documento) || 0,
              categoria_atual: "SEM CATEGORIA",
              status: r.status_titulo || "—",
              onde_corrigir: "Omie → Contas a Receber → Localizar pelo documento → Atribuir categoria (ex: 1.01.01 Venda de Mercadorias)",
            });
          }
        }
      }
      const cpImports = imports.filter(i=>i.import_type==="contas_pagar");
      for(const cp of cpImports){
        const regs = cp.import_data?.conta_pagar_cadastro || [];
        if(!Array.isArray(regs)) continue;
        for(const r of regs){
          const cat = r.codigo_categoria || "";
          if(!cat || cat === "sem_cat" || cat === "0") {
            semCatItens.push({
              data: r.data_emissao || r.data_vencimento || "—",
              doc: r.numero_documento || r.numero_documento_fiscal || "—",
              valor: Number(r.valor_documento) || 0,
              categoria_atual: "SEM CATEGORIA",
              status: r.status_titulo || "—",
              onde_corrigir: "Omie → Contas a Pagar → Localizar pelo documento → Atribuir categoria correta",
            });
          }
        }
      }
      if(semCatItens.length > 0) {
        alerts.push({tipo:"sem_categoria",severidade:"critico",
          mensagem:`${semCatItens.length} lançamentos sem categoria (${fmtR(semCatItens.reduce((s,i) => s + i.valor, 0))})`,
          detalhe:"Lançamentos sem categoria não aparecem corretamente no DRE e distorcem a análise de custos.",
          sugestao:"Abra o Omie e classifique cada lançamento na categoria correta.",
          itens: semCatItens.slice(0, 20),
        });
      }

      // 3. Lançamentos vencidos/atrasados
      const atrasadosItens: any[] = [];
      for(const cr of recImports){
        const regs = cr.import_data?.conta_receber_cadastro || [];
        if(!Array.isArray(regs)) continue;
        for(const r of regs){
          if(r.status_titulo === "ATRASADO") {
            atrasadosItens.push({
              data: r.data_vencimento || r.data_emissao || "—",
              doc: r.numero_documento || "—",
              valor: Number(r.valor_documento) || 0,
              categoria_atual: r.descricao_categoria || r.codigo_categoria || "—",
              status: "ATRASADO",
              onde_corrigir: "Cobrar o cliente ou registrar como perda no Omie → Contas a Receber → Baixar como Prejuízo",
            });
          }
        }
      }
      if(atrasadosItens.length > 0) {
        alerts.push({tipo:"inadimplencia",severidade:"atencao",
          mensagem:`${atrasadosItens.length} títulos atrasados (${fmtR(atrasadosItens.reduce((s,i) => s + i.valor, 0))})`,
          detalhe:"Valores vencidos que ainda não foram recebidos. Impacta diretamente o fluxo de caixa.",
          sugestao:"Acione a cobrança ou renegocie. Títulos acima de 90 dias devem ser provisionados como perda.",
          itens: atrasadosItens.slice(0, 20),
        });
      }

      // 4. Datas futuras (longo prazo)
      let futureCount = 0;
      const now = new Date();
      for(const cp of cpImports){
        const regs = cp.import_data?.conta_pagar_cadastro || [];
        if(!Array.isArray(regs)) continue;
        for(const r of regs){
          const dt = r.data_vencimento || "";
          if(dt){const parts = dt.split("/");if(parts.length===3){const year = parseInt(parts[2]);if(year > now.getFullYear()+1) futureCount++;}}
        }
      }
      if(futureCount > 0) {
        alerts.push({tipo:"datas_futuras",severidade:"info",
          mensagem:`${futureCount} registros com vencimento após ${now.getFullYear()+1}`,
          detalhe:"Parcelas de financiamentos e contratos de longo prazo.",
          sugestao:"Verifique se são parcelas reais ou erros de cadastro no Omie",itens:[]});
      }
    }
    setAlertas(alerts);
  };

  const showToast = (msg:string,tipo:"ok"|"err") => {
    setToast({msg,tipo});
    setTimeout(()=>setToast(null),3000);
  };

  const salvarEmpresa = async () => {
    if(!selectedCompany) return;
    const { error } = await supabase.from("companies").update({
      razao_social: empresa.razao_social,
      nome_fantasia: empresa.nome_fantasia,
      cnpj: empresa.cnpj,
      cidade_estado: empresa.cidade_estado,
      setor: empresa.setor,
      num_colaboradores: parseInt(empresa.num_colaboradores) || null,
      faturamento_anual: parseFloat(empresa.faturamento_anual) || null,
      pais: empresa.pais,
      moeda: empresa.moeda,
      regime_tributario: empresa.regime_tributario,
      tipo_empresa: empresa.tipo_empresa,
      id_fiscal_exterior: empresa.id_fiscal_exterior || null,
    }).eq("id", selectedCompany);
    if(error) { showToast("Erro: "+error.message,"err"); return; }
    showToast("Empresa salva com sucesso!","ok");
  };

  const salvarLinhas = async () => {
    if(!selectedCompany) return;
    // Get user's org_id
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;
    let { data: userProfile } = await supabase.from("users").select("org_id").eq("id", user.id).single();

    for(const ln of linhas) {
      if(!ln.nome.trim()) continue;
      if(ln.id) {
        await supabase.from("business_lines").update({name:ln.nome,type:ln.tipo,responsible:ln.responsavel}).eq("id",ln.id);
      } else {
        const { data } = await supabase.from("business_lines").insert({
          company_id: selectedCompany,
          org_id: userProfile?.org_id,
          name: ln.nome,
          type: ln.tipo,
          responsible: ln.responsavel,
        }).select().single();
        if(data) ln.id = data.id;
      }
    }
    showToast("Linhas de negócio salvas!","ok");
    loadBusinessLines(selectedCompany);
  };

  const salvarResultado = async () => {
    if(!selectedCompany) return;
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;
    let { data: userProfile } = await supabase.from("users").select("org_id").eq("id", user.id).single();
    const [year, month] = mesSel.split("-").map(Number);

    for(const r of resultado) {
      if(!r.ln_id || !r.faturamento_bruto) continue;
      const payload = {
        org_id: userProfile?.org_id,
        company_id: selectedCompany,
        business_line_id: r.ln_id,
        year, month,
        faturamento_bruto: parseFloat(r.faturamento_bruto) || 0,
        devolucoes: parseFloat(r.devolucoes) || 0,
        custo_produtos: parseFloat(r.custo_produtos) || 0,
        mao_obra_direta: parseFloat(r.mao_obra_direta) || 0,
        frete: parseFloat(r.frete) || 0,
        comissoes: parseFloat(r.comissoes) || 0,
        terceiros: parseFloat(r.terceiros) || 0,
        marketing_direto: parseFloat(r.marketing_direto) || 0,
        num_clientes: parseInt(r.num_clientes) || 0,
        ticket_medio: parseFloat(r.ticket_medio) || 0,
      };
      // Upsert
      const { data: existing } = await supabase.from("m2_dre_divisional")
        .select("id").eq("company_id",selectedCompany).eq("business_line_id",r.ln_id).eq("year",year).eq("month",month).single();
      if(existing) {
        await supabase.from("m2_dre_divisional").update(payload).eq("id",existing.id);
      } else {
        await supabase.from("m2_dre_divisional").insert(payload);
      }
    }
    showToast(`Resultado de ${MESES.find(m=>m.value===mesSel)?.label} salvo!`,"ok");
  };

  const salvarEstrutura = async () => {
    if(!selectedCompany) return;
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;
    let { data: userProfile } = await supabase.from("users").select("org_id").eq("id", user.id).single();
    const [year, month] = mesSel.split("-").map(Number);
    
    // Build payload from active costs + custom costs
    const payload: any = {
      org_id: userProfile?.org_id,
      company_id: selectedCompany,
      year, month,
    };
    
    // Add all known cost fields
    const knownFields = ["prolabore","folha_adm","encargos","aluguel","energia","internet",
      "contabilidade","juridico","combustivel","manutencao_veic","marketing_inst",
      "taxas_cartao","seguros","depreciacao","outros"];
    knownFields.forEach(f => { payload[f] = parseFloat(custos[f]) || 0; });
    
    // Store all costs (including non-schema ones) in a JSON field
    const allCosts: Record<string,number> = {};
    Object.entries(custos).forEach(([k,v]) => { if(parseFloat(v)) allCosts[k] = parseFloat(v); });
    custosCustom.forEach(c => { if(c.nome && parseFloat(c.valor)) allCosts["custom_"+c.nome] = parseFloat(c.valor); });
    payload.cost_details = allCosts;

    const { data: existing } = await supabase.from("m3_dre_sede")
      .select("id").eq("company_id",selectedCompany).eq("year",year).eq("month",month).single();
    if(existing) {
      await supabase.from("m3_dre_sede").update(payload).eq("id",existing.id);
    } else {
      await supabase.from("m3_dre_sede").insert(payload);
    }
    showToast(`Custos de ${MESES.find(m=>m.value===mesSel)?.label} salvos!`,"ok");
  };

  const salvarContexto = async () => {
    if(!selectedCompany) return;
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;
    let { data: userProfile } = await supabase.from("users").select("org_id").eq("id", user.id).single();

    // Save to ai_reports as context type
    await supabase.from("ai_reports").insert({
      org_id: userProfile?.org_id,
      company_id: selectedCompany,
      report_type: "contexto_humano",
      period_start: mesSel + "-01",
      period_end: mesSel + "-28",
      report_data: contexto,
      generated_by: user.id,
    });
    showToast("Painel de Contexto salvo!","ok");
  };

  const abas = [
    {id:"empresa",nome:"Empresa"},
    {id:"negocios",nome:"Linhas de Negócio"},
    {id:"resultado",nome:"Resultado / Mês"},
    {id:"estrutura",nome:"Custos Estrutura"},
    {id:"contexto",nome:"Painel de Contexto"},
    {id:"plano",nome:"Plano de Ação"},
    {id:"integracoes",nome:"⚡ Integrações"},
  ];

  return (
    <div style={{padding:"14px 20px",maxWidth:900,margin:"0 auto"}}>
      {toast && <Toast msg={toast.msg} tipo={toast.tipo}/>}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:3,height:16,background:GO,borderRadius:2}}/>
            <span style={{fontSize:18,fontWeight:700,color:TX}}>Entrada de Dados</span>
          </div>
          <div style={{fontSize:11,color:TXD,marginTop:4,marginLeft:11}}>Preencha os dados de cada módulo para gerar análises reais</div>
        </div>
        <a href="/dashboard" style={{fontSize:11,color:GO,textDecoration:"none"}}>← Voltar ao Dashboard</a>
      </div>

      {/* Company selector */}
      {companies.length > 0 && (
        <Card>
          <div style={{display:"flex",gap:12,alignItems:"center"}}>
            <div style={{flex:1}}>
              <div style={{marginBottom:12}}>
                <label style={{fontSize:11,color:TXM,display:"block",marginBottom:4}}>Empresa ativa</label>
                <select value={selectedCompany} onChange={e=>{
                  const v=e.target.value;
                  setSelectedCompany(v);
                  if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",v);
                  const c = companies.find(c=>c.id===v);
                  if(c) {
                    setEmpresa({razao_social:c.razao_social||"",nome_fantasia:c.nome_fantasia||"",cnpj:c.cnpj||"",cidade_estado:c.cidade_estado||"",setor:c.setor||"",num_colaboradores:c.num_colaboradores?.toString()||"",faturamento_anual:c.faturamento_anual?.toString()||"",pais:c.pais||"Brasil",moeda:c.moeda||"BRL",regime_tributario:c.regime_tributario||"simples",tipo_empresa:c.tipo_empresa||"matriz",id_fiscal_exterior:c.id_fiscal_exterior||""});
                    setOmieKey(c.omie_app_key||"");setOmieSecret(c.omie_app_secret||"");
                    if(c.omie_app_key)setOmieErp("omie");
                    loadBusinessLines(v);
                  }
                }} style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,width:"100%"}}>
                  {groups.map(g=>{
                    const gComps=companies.filter(c=>c.group_id===g.id);
                    if(gComps.length===0)return null;
                    return(<optgroup key={g.id} label={`📁 ${g.nome} (${gComps.length} empresas)`}>
                      {gComps.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
                    </optgroup>);
                  })}
                  {companies.filter(c=>!c.group_id).length>0&&(
                    <optgroup label="── Sem grupo ──">
                      {companies.filter(c=>!c.group_id).map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
            {(aba==="resultado"||aba==="estrutura")&&(
              <div style={{flex:1}}>
                <Select label="Mês de referência" value={mesSel} onChange={setMesSel} options={MESES}/>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Data Alerts */}
      {alertas.length>0&&(
        <div style={{marginBottom:10}}>
          {alertas.map((a,i)=>(
            <div key={i} style={{
              background:a.severidade==="critico"?R+"12":a.severidade==="atencao"?Y+"10":B+"08",
              borderRadius:12,padding:"12px 16px",marginBottom:8,
              borderLeft:`4px solid ${a.severidade==="critico"?R:a.severidade==="atencao"?Y:B}`,
              border:`1px solid ${a.severidade==="critico"?R+"30":a.severidade==="atencao"?Y+"25":B+"20"}`
            }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:a.severidade==="critico"?R:a.severidade==="atencao"?Y:B}}>
                    {a.severidade==="critico"?"🔴 Crítico":a.severidade==="atencao"?"⚠️ Atenção":"ℹ️ Informação"}: {a.mensagem}
                  </div>
                  {a.detalhe&&<div style={{fontSize:11,color:TXM,marginTop:4,lineHeight:1.5}}>{a.detalhe}</div>}
                  {a.sugestao&&<div style={{fontSize:11,color:G,marginTop:4,fontWeight:500}}>💡 {a.sugestao}</div>}
                </div>
                {a.itens&&a.itens.length>0&&(
                  <button onClick={()=>setAlertaAberto(alertaAberto===i?null:i)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer",whiteSpace:"nowrap",marginLeft:8}}>
                    {alertaAberto===i?"▲ Fechar":`▼ Ver ${a.itens.length} itens`}
                  </button>
                )}
              </div>

              {alertaAberto===i&&a.itens&&a.itens.length>0&&(
                <div style={{marginTop:10,maxHeight:300,overflowY:"auto"}}>
                  <table style={{width:"100%",fontSize:10,borderCollapse:"collapse"}}>
                    <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                      <th style={{padding:"6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>DATA</th>
                      <th style={{padding:"6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>DOCUMENTO</th>
                      <th style={{padding:"6px",textAlign:"right",color:GO,fontSize:9,fontWeight:600}}>VALOR</th>
                      <th style={{padding:"6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>CATEGORIA ATUAL</th>
                      <th style={{padding:"6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>STATUS</th>
                      <th style={{padding:"6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>ONDE CORRIGIR</th>
                    </tr></thead>
                    <tbody>
                      {a.itens.map((item:any,ii:number)=>(
                        <tr key={ii} style={{borderBottom:`0.5px solid ${BD}20`}}>
                          <td style={{padding:"6px",color:TX,whiteSpace:"nowrap",fontSize:11}}>{item.data}</td>
                          <td style={{padding:"6px",color:TX,fontFamily:"monospace",fontSize:11}}>{item.doc}</td>
                          <td style={{padding:"6px",textAlign:"right",color:R,fontWeight:600,fontSize:11}}>{fmtR(item.valor)}</td>
                          <td style={{padding:"6px",color:Y,fontSize:10}}>{item.categoria_atual}</td>
                          <td style={{padding:"6px"}}><span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:item.status==="ATRASADO"?R+"15":item.status==="RECEBIDO"||item.status==="PAGO"?G+"15":TXD+"10",color:item.status==="ATRASADO"?R:item.status==="RECEBIDO"||item.status==="PAGO"?G:TXM}}>{item.status}</span></td>
                          <td style={{padding:"6px",color:G,fontSize:10,maxWidth:200}}>{item.onde_corrigir}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {a.itens.length>=20&&<div style={{fontSize:10,color:TXD,textAlign:"center",marginTop:6}}>Mostrando os primeiros 20 de {a.itens.length} itens</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",gap:3,marginBottom:14,overflowX:"auto"}}>
        {abas.map(a=>(
          <button key={a.id} onClick={()=>setAba(a.id)} style={{
            padding:"8px 16px",borderRadius:20,fontSize:11,whiteSpace:"nowrap",
            border:`0.5px solid ${aba===a.id?GO:BD}`,
            background:aba===a.id?GO+"18":"transparent",
            color:aba===a.id?GOL:TXM,fontWeight:aba===a.id?600:400
          }}>{a.nome}</button>
        ))}
      </div>

      {/* === EMPRESA (M0) === */}
      {aba==="empresa"&&(
        <div>
        <Card title="Cadastro da Empresa">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Input label="Razão Social *" value={empresa.razao_social} onChange={(v:string)=>setEmpresa({...empresa,razao_social:v})} placeholder="Razão social completa"/>
            <Input label="Nome Fantasia" value={empresa.nome_fantasia} onChange={(v:string)=>setEmpresa({...empresa,nome_fantasia:v})} placeholder="Nome fantasia"/>
            <Input label="CNPJ / ID Fiscal" value={empresa.cnpj} onChange={(v:string)=>setEmpresa({...empresa,cnpj:v})} placeholder="00.000.000/0001-00"/>
            <Input label="Cidade / Estado" value={empresa.cidade_estado} onChange={(v:string)=>setEmpresa({...empresa,cidade_estado:v})} placeholder="Chapecó/SC"/>
            <Input label="Setor de Atuação" value={empresa.setor} onChange={(v:string)=>setEmpresa({...empresa,setor:v})} placeholder="Ex: Materiais Elétricos"/>
            <Input label="Nº de Colaboradores" value={empresa.num_colaboradores} onChange={(v:string)=>setEmpresa({...empresa,num_colaboradores:v})} type="number" placeholder="54"/>
            <Input label="Faturamento Anual Estimado" value={empresa.faturamento_anual} onChange={(v:string)=>setEmpresa({...empresa,faturamento_anual:v})} prefix={empresa.moeda==="BRL"?"R$":empresa.moeda==="USD"?"US$":empresa.moeda==="EUR"?"€":empresa.moeda} type="number" placeholder="26000000"/>
          </div>
        </Card>

        <Card title="País, Moeda e Regime">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <Select label="País" value={empresa.pais} onChange={(v:string)=>{
              const moedas:Record<string,string>={"Brasil":"BRL","Argentina":"ARS","Paraguai":"PYG","Uruguai":"UYU","Chile":"CLP","Colômbia":"COP","Peru":"PEN","México":"MXN","Portugal":"EUR","Espanha":"EUR","Estados Unidos":"USD","Outro":"USD"};
              setEmpresa({...empresa,pais:v,moeda:moedas[v]||"USD"});
            }} options={[
              {value:"Brasil",label:"Brasil"},{value:"Argentina",label:"Argentina"},{value:"Paraguai",label:"Paraguai"},
              {value:"Uruguai",label:"Uruguai"},{value:"Chile",label:"Chile"},{value:"Colômbia",label:"Colômbia"},
              {value:"Peru",label:"Peru"},{value:"México",label:"México"},{value:"Portugal",label:"Portugal"},
              {value:"Espanha",label:"Espanha"},{value:"Estados Unidos",label:"Estados Unidos"},{value:"Outro",label:"Outro"},
            ]}/>
            <Select label="Moeda" value={empresa.moeda} onChange={(v:string)=>setEmpresa({...empresa,moeda:v})} options={[
              {value:"BRL",label:"BRL — Real Brasileiro"},{value:"ARS",label:"ARS — Peso Argentino"},
              {value:"USD",label:"USD — Dólar Americano"},{value:"EUR",label:"EUR — Euro"},
              {value:"PYG",label:"PYG — Guarani"},{value:"UYU",label:"UYU — Peso Uruguaio"},
              {value:"CLP",label:"CLP — Peso Chileno"},{value:"COP",label:"COP — Peso Colombiano"},
              {value:"PEN",label:"PEN — Sol Peruano"},{value:"MXN",label:"MXN — Peso Mexicano"},
            ]}/>
            <Select label="Tipo de Empresa" value={empresa.tipo_empresa} onChange={(v:string)=>setEmpresa({...empresa,tipo_empresa:v})} options={[
              {value:"matriz",label:"Matriz"},{value:"filial",label:"Filial"},{value:"holding",label:"Holding"},
              {value:"servicos",label:"Empresa de Serviços"},{value:"comercio",label:"Empresa de Comércio"},
              {value:"industria",label:"Indústria"},{value:"exterior",label:"Operação no Exterior"},
            ]}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:8}}>
            <Select label="Regime Tributário" value={empresa.regime_tributario} onChange={(v:string)=>setEmpresa({...empresa,regime_tributario:v})} options={[
              {value:"simples",label:"Simples Nacional"},{value:"presumido",label:"Lucro Presumido"},
              {value:"real",label:"Lucro Real"},{value:"mei",label:"MEI"},
              {value:"exterior",label:"Regime do país de origem"},
            ]}/>
            {empresa.pais!=="Brasil"&&(
              <Input label="ID Fiscal do Exterior (CUIT, RUT, NIF, etc.)" value={empresa.id_fiscal_exterior} onChange={(v:string)=>setEmpresa({...empresa,id_fiscal_exterior:v})} placeholder="Ex: 30-12345678-9"/>
            )}
          </div>
          {empresa.pais!=="Brasil"&&(
            <div style={{background:Y+"15",borderRadius:8,padding:10,marginTop:10,border:`0.5px solid ${Y}40`}}>
              <div style={{fontSize:11,color:TX}}>
                <strong style={{color:Y}}>Empresa no exterior:</strong> Os valores serão cadastrados em {empresa.moeda} e convertidos para BRL na consolidação do grupo usando a taxa de câmbio do período.
              </div>
            </div>
          )}
        </Card>

        {companies.length>1&&(
          <Card title={`Visão do Grupo — ${companies.length} empresas cadastradas`}>
            <div style={{fontSize:11,color:TXM,marginBottom:10}}>Todas as empresas do grupo. O dashboard consolida automaticamente.</div>
            {companies.map((c,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`0.5px solid ${BD}20`}}>
                <div style={{width:8,height:8,borderRadius:4,background:c.id===selectedCompany?GO:BD}}/>
                <div style={{flex:1}}>
                  <span style={{fontSize:12,color:c.id===selectedCompany?GOL:TX,fontWeight:c.id===selectedCompany?600:400}}>{c.nome_fantasia||c.razao_social}</span>
                  <span style={{fontSize:9,color:TXD,marginLeft:8}}>{c.cnpj||"Sem CNPJ"} | {c.pais||"Brasil"} | {c.moeda||"BRL"}</span>
                </div>
                <span style={{fontSize:9,color:TXD,background:BG3,padding:"2px 8px",borderRadius:4}}>{c.tipo_empresa||"matriz"}</span>
              </div>
            ))}
          </Card>
        )}

          <div style={{display:"flex",justifyContent:"flex-end"}}>
            <Btn onClick={salvarEmpresa}>◆ Salvar Dados da Empresa</Btn>
          </div>
        </div>
      )}

      {/* === LINHAS DE NEGÓCIO === */}
      {aba==="negocios"&&(
        <Card title="Linhas de Negócio">
          <div style={{fontSize:11,color:TXM,marginBottom:14}}>Cadastre cada negócio/departamento que gera receita. Exemplo: Venda de Equipamentos, Projetos Residenciais, Manutenção, etc.</div>
          {linhas.map((ln,i)=>(
            <div key={i} style={{background:BG3,borderRadius:8,padding:12,marginBottom:8,border:`0.5px solid ${BD}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:600,color:GOL}}>Negócio {i+1}</div>
                {linhas.length>1&&<button onClick={()=>setLinhas(linhas.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:R,fontSize:11,cursor:"pointer"}}>Remover</button>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8}}>
                <Input label="Nome do negócio" value={ln.nome} onChange={(v:string)=>{const n=[...linhas];n[i].nome=v;setLinhas(n);}} placeholder="Ex: Venda de Equipamentos" small/>
                <Select label="Tipo" value={ln.tipo} onChange={(v:string)=>{const n=[...linhas];n[i].tipo=v;setLinhas(n);}}
                  options={[{value:"comercio",label:"Comércio"},{value:"servico",label:"Serviço"},{value:"industria",label:"Indústria"},{value:"distribuicao",label:"Distribuição"}]}/>
                <Input label="Responsável" value={ln.responsavel} onChange={(v:string)=>{const n=[...linhas];n[i].responsavel=v;setLinhas(n);}} placeholder="Nome" small/>
              </div>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",marginTop:12}}>
            <button onClick={()=>setLinhas([...linhas,{nome:"",tipo:"comercio",responsavel:""}])} style={{background:"none",border:`1px dashed ${GO}`,color:GO,padding:"8px 16px",borderRadius:8,fontSize:11,cursor:"pointer"}}>+ Adicionar Negócio</button>
            <Btn onClick={salvarLinhas}>◆ Salvar Linhas de Negócio</Btn>
          </div>
        </Card>
      )}

      {/* === RESULTADO POR NEGÓCIO (M2) === */}
      {aba==="resultado"&&(
        <div>
          <Card title={`Resultado por Negócio — ${MESES.find(m=>m.value===mesSel)?.label}`}>
            <div style={{fontSize:11,color:TXM,marginBottom:14}}>Preencha faturamento e custos diretos de cada negócio no mês selecionado. Valores em reais (sem centavos).</div>
          </Card>

          {resultado.length===0?(
            <Card>
              <div style={{textAlign:"center",padding:20,color:TXD,fontSize:12}}>
                Cadastre as linhas de negócio primeiro na aba "Linhas de Negócio".
              </div>
            </Card>
          ):(
            resultado.map((r,i)=>(
              <Card key={i} title={r.ln_nome}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  <Input label="Faturamento Bruto" value={r.faturamento_bruto} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].faturamento_bruto=v;setResultado(n);}} placeholder="580000"/>
                  <Input label="(-) Devoluções + Impostos" value={r.devolucoes} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].devolucoes=v;setResultado(n);}} placeholder="32000"/>
                  <Input label="(-) Custo dos Produtos/Insumos" value={r.custo_produtos} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].custo_produtos=v;setResultado(n);}} placeholder="348000"/>
                  <Input label="(-) Mão de Obra Direta" value={r.mao_obra_direta} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].mao_obra_direta=v;setResultado(n);}} placeholder="38000"/>
                  <Input label="(-) Frete/Logística" value={r.frete} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].frete=v;setResultado(n);}} placeholder="15000"/>
                  <Input label="(-) Comissões" value={r.comissoes} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].comissoes=v;setResultado(n);}} placeholder="20000"/>
                  <Input label="(-) Terceirização" value={r.terceiros} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].terceiros=v;setResultado(n);}} placeholder="12000"/>
                  <Input label="(-) Marketing Direto" value={r.marketing_direto} prefix="R$" type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].marketing_direto=v;setResultado(n);}} placeholder="8000"/>
                  <Input label="Nº de Clientes no mês" value={r.num_clientes} type="number"
                    onChange={(v:string)=>{const n=[...resultado];n[i].num_clientes=v;setResultado(n);}} placeholder="120"/>
                </div>
                {r.faturamento_bruto && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:10,background:BG3,borderRadius:6,padding:10}}>
                    <div><div style={{fontSize:8,color:TXD}}>Faturamento</div><div style={{fontSize:14,fontWeight:700,color:TX}}>R$ {parseFloat(r.faturamento_bruto||0).toLocaleString("pt-BR")}</div></div>
                    <div><div style={{fontSize:8,color:TXD}}>Custos Diretos</div><div style={{fontSize:14,fontWeight:700,color:R}}>R$ {(parseFloat(r.devolucoes||0)+parseFloat(r.custo_produtos||0)+parseFloat(r.mao_obra_direta||0)+parseFloat(r.frete||0)+parseFloat(r.comissoes||0)+parseFloat(r.terceiros||0)+parseFloat(r.marketing_direto||0)).toLocaleString("pt-BR")}</div></div>
                    <div><div style={{fontSize:8,color:TXD}}>Margem Direta</div><div style={{fontSize:14,fontWeight:700,color:G}}>R$ {(parseFloat(r.faturamento_bruto||0)-parseFloat(r.devolucoes||0)-parseFloat(r.custo_produtos||0)-parseFloat(r.mao_obra_direta||0)-parseFloat(r.frete||0)-parseFloat(r.comissoes||0)-parseFloat(r.terceiros||0)-parseFloat(r.marketing_direto||0)).toLocaleString("pt-BR")}</div></div>
                  </div>
                )}
              </Card>
            ))
          )}

          {resultado.length>0&&(
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
              <Btn onClick={salvarResultado}>◆ Salvar Resultado de {MESES.find(m=>m.value===mesSel)?.label}</Btn>
            </div>
          )}
        </div>
      )}

      {/* === CUSTOS ESTRUTURA (M3) === */}
      {aba==="estrutura"&&(
        <div>
          <Card title={`Custos da Estrutura Central — ${MESES.find(m=>m.value===mesSel)?.label}`}>
            <div style={{fontSize:11,color:TXM,marginBottom:10}}>São os custos da sede que serão rateados proporcionalmente entre os negócios. Marque os que se aplicam à empresa e preencha os valores mensais.</div>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              <button onClick={()=>setMostrarTodos(!mostrarTodos)} style={{background:"none",border:`1px solid ${GO}`,color:GO,padding:"6px 14px",borderRadius:6,fontSize:10,cursor:"pointer"}}>
                {mostrarTodos?"Mostrar só ativos":"Mostrar todas as 50+ contas"}
              </button>
            </div>
          </Card>

          {CONTAS_CUSTO.map(grupo=>{
            const contasVisiveis = mostrarTodos ? grupo.contas : grupo.contas.filter(c=>custosAtivos[c.id]);
            if(!mostrarTodos && contasVisiveis.length===0) return null;
            return(
              <Card key={grupo.grupo}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{width:10,height:10,borderRadius:3,background:grupo.cor}}/>
                  <div style={{fontSize:13,fontWeight:600,color:grupo.cor}}>{grupo.grupo}</div>
                  <div style={{fontSize:10,color:TXD}}>({grupo.contas.filter(c=>custosAtivos[c.id]).length} ativas)</div>
                </div>
                {(mostrarTodos?grupo.contas:contasVisiveis).map(conta=>(
                  <div key={conta.id} title={conta.desc||""} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 4px",borderBottom:`0.5px solid ${BD}20`,cursor:"default"}}>
                    <input type="checkbox" checked={!!custosAtivos[conta.id]} onChange={e=>{
                      setCustosAtivos({...custosAtivos,[conta.id]:e.target.checked});
                      if(!e.target.checked) { const n={...custos}; delete n[conta.id]; setCustos(n); }
                    }} style={{accentColor:GO,width:16,height:16,flexShrink:0}}/>
                    <span style={{fontSize:12,color:custosAtivos[conta.id]?TX:TXD,flex:1}}>{conta.nome}</span>
                    {custosAtivos[conta.id]&&(
                      <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                        <span style={{fontSize:10,color:TXD}}>R$</span>
                        <input type="number" value={custos[conta.id]||""} onChange={e=>setCustos({...custos,[conta.id]:e.target.value})}
                          placeholder="0" style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:4,padding:"5px 8px",fontSize:13,width:120,textAlign:"right",fontWeight:600}}/>
                      </div>
                    )}
                  </div>
                ))}
              </Card>
            );
          })}

          {/* Custom accounts */}
          <Card title="Custos Personalizados">
            <div style={{fontSize:10,color:TXD,marginBottom:10}}>Adicione custos que não estão na lista acima.</div>
            {custosCustom.map((c,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:6,alignItems:"center"}}>
                <input type="text" value={c.nome} onChange={e=>{const n=[...custosCustom];n[i].nome=e.target.value;setCustosCustom(n);}}
                  placeholder="Nome do custo" style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"6px 10px",fontSize:11,flex:1}}/>
                <span style={{fontSize:10,color:TXD}}>R$</span>
                <input type="number" value={c.valor} onChange={e=>{const n=[...custosCustom];n[i].valor=e.target.value;setCustosCustom(n);}}
                  placeholder="0" style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"6px 10px",fontSize:12,width:100,textAlign:"right"}}/>
                <button onClick={()=>setCustosCustom(custosCustom.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:R,fontSize:14,cursor:"pointer"}}>×</button>
              </div>
            ))}
            <button onClick={()=>setCustosCustom([...custosCustom,{nome:"",valor:""}])} style={{background:"none",border:`1px dashed ${GO}`,color:GO,padding:"6px 14px",borderRadius:6,fontSize:10,cursor:"pointer",marginTop:6}}>+ Adicionar custo personalizado</button>
          </Card>

          {/* Total */}
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:11,color:TXM}}>Total da Estrutura Central no mês</div>
                <div style={{fontSize:9,color:TXD,marginTop:2}}>{Object.keys(custos).filter(k=>parseFloat(custos[k])).length + custosCustom.filter(c=>parseFloat(c.valor)).length} contas preenchidas</div>
              </div>
              <div style={{fontSize:24,fontWeight:700,color:GOL}}>R$ {(
                Object.values(custos).reduce((a,v)=>a+(parseFloat(v)||0),0) +
                custosCustom.reduce((a,c)=>a+(parseFloat(c.valor)||0),0)
              ).toLocaleString("pt-BR")}</div>
            </div>
          </Card>

          <div style={{display:"flex",justifyContent:"flex-end",marginTop:4,marginBottom:20}}>
            <Btn onClick={salvarEstrutura}>◆ Salvar Custos de {MESES.find(m=>m.value===mesSel)?.label}</Btn>
          </div>
        </div>
      )}

      {/* === PAINEL DE CONTEXTO (Bloco 18) === */}
      {aba==="contexto"&&(
        <Card title="Painel de Contexto Humano — O que a IA precisa saber">
          <div style={{fontSize:11,color:TXM,marginBottom:14}}>
            Preencha antes de gerar o relatório. A IA cruza essas informações com os dados financeiros para dar recomendações personalizadas.
            Quanto mais detalhado, melhor a análise.
          </div>

          {[
            {key:"problemas",label:"1. Quais são os maiores problemas da empresa AGORA?",placeholder:"Ex: Equipe de vendas desmotivada, fornecedor principal atrasando entregas, concorrente novo entrando na região..."},
            {key:"mudancas_mercado",label:"2. O que mudou no mercado recentemente?",placeholder:"Ex: Preço do dólar subiu 8%, novo concorrente abriu, cliente grande saiu, lei nova afetou o setor..."},
            {key:"decisoes_pendentes",label:"3. Quais decisões importantes estão pendentes?",placeholder:"Ex: Contratar mais 2 vendedores? Abrir filial? Trocar fornecedor? Encerrar linha de negócio?"},
            {key:"oportunidades",label:"4. Quais oportunidades você enxerga?",placeholder:"Ex: Licitação grande em aberto, parceria com construtora, expansão para cidade vizinha..."},
            {key:"problemas_clientes",label:"5. O que os clientes e a equipe estão reclamando?",placeholder:"Ex: Prazo de entrega longo, preço alto comparado com concorrente, falta de peças no estoque..."},
            {key:"metas_sonhos",label:"6. Quais suas metas e sonhos para os próximos 12 meses?",placeholder:"Ex: Faturar R$ 30M, abrir filial em Xanxerê, contratar gerente comercial, tirar férias tranquilo..."},
            {key:"observacoes",label:"7. Algo mais que a IA deveria saber?",placeholder:"Ex: Sócio quer sair, estamos negociando compra de concorrente, banco ofereceu crédito..."},
          ].map((campo)=>(
            <div key={campo.key} style={{marginBottom:16}}>
              <label style={{fontSize:12,color:GOL,fontWeight:600,display:"block",marginBottom:6}}>{campo.label}</label>
              <textarea value={(contexto as any)[campo.key]} onChange={e=>setContexto({...contexto,[campo.key]:e.target.value})}
                placeholder={campo.placeholder} rows={3}
                style={{background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"10px 12px",fontSize:12,width:"100%",resize:"vertical",lineHeight:1.6}}/>
            </div>
          ))}

          <div style={{marginTop:8,display:"flex",justifyContent:"flex-end"}}>
            <Btn onClick={salvarContexto}>◆ Salvar Painel de Contexto</Btn>
          </div>
        </Card>
      )}

      {/* === PLANO DE AÇÃO === */}
      {aba==="plano"&&(
        <div>
          <Card title="Plano de Ação da Empresa">
            <div style={{fontSize:11,color:TXM,marginBottom:14}}>
              Registre as ações que a empresa está implementando. A IA vai cruzar essas ações com os dados financeiros para acompanhar a execução e cobrar resultados.
            </div>

            {/* Lista de ações existentes */}
            {acoes.map((a,i)=>(
              <div key={a.id||i} style={{background:BG3,borderRadius:8,padding:12,marginBottom:8,borderLeft:`4px solid ${a.status==="concluida"?G:a.status==="em_andamento"?Y:a.prioridade==="alta"?R:GO}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:TX}}>{a.acao}</div>
                    <div style={{fontSize:10,color:TXM,marginTop:4}}>
                      {a.responsavel&&<span>Responsável: {a.responsavel} | </span>}
                      {a.prazo&&<span>Prazo: {new Date(a.prazo).toLocaleDateString("pt-BR")} | </span>}
                      <span style={{color:a.prioridade==="alta"?R:a.prioridade==="media"?Y:G}}>Prioridade: {a.prioridade}</span>
                      {a.categoria&&<span> | {a.categoria}</span>}
                    </div>
                    {a.impacto_esperado&&<div style={{fontSize:10,color:GOL,marginTop:4}}>Impacto esperado: {a.impacto_esperado}</div>}
                    {a.observacoes&&<div style={{fontSize:10,color:TXD,marginTop:2}}>{a.observacoes}</div>}
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    <select value={a.status} onChange={async(e)=>{
                      const newStatus=e.target.value;
                      await supabase.from("plano_acao").update({status:newStatus,updated_at:new Date().toISOString()}).eq("id",a.id);
                      setAcoes(acoes.map(x=>x.id===a.id?{...x,status:newStatus}:x));
                      showToast("Status atualizado!","ok");
                    }} style={{background:BG2,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"3px 6px",fontSize:10}}>
                      <option value="pendente">Pendente</option>
                      <option value="em_andamento">Em andamento</option>
                      <option value="concluida">Concluída</option>
                      <option value="cancelada">Cancelada</option>
                    </select>
                    <button onClick={async()=>{
                      await supabase.from("plano_acao").delete().eq("id",a.id);
                      setAcoes(acoes.filter(x=>x.id!==a.id));
                      showToast("Ação removida","ok");
                    }} style={{background:"none",border:"none",color:R,fontSize:14,cursor:"pointer"}}>×</button>
                  </div>
                </div>
              </div>
            ))}

            {acoes.length===0&&(
              <div style={{textAlign:"center",padding:20,color:TXD,fontSize:11}}>Nenhuma ação cadastrada. Adicione ações que a empresa está implementando.</div>
            )}
          </Card>

          {/* Formulário nova ação */}
          <Card title="Adicionar Nova Ação">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div style={{gridColumn:"1/3"}}>
                <Input label="Descrição da ação *" value={novaAcao.acao} onChange={(v:string)=>setNovaAcao({...novaAcao,acao:v})} placeholder="Ex: Renegociar contrato com fornecedor X para reduzir custo em 15%"/>
              </div>
              <Input label="Responsável" value={novaAcao.responsavel} onChange={(v:string)=>setNovaAcao({...novaAcao,responsavel:v})} placeholder="Nome do responsável"/>
              <Input label="Prazo" value={novaAcao.prazo} onChange={(v:string)=>setNovaAcao({...novaAcao,prazo:v})} type="date"/>
              <Select label="Prioridade" value={novaAcao.prioridade} onChange={(v:string)=>setNovaAcao({...novaAcao,prioridade:v})} options={[
                {value:"alta",label:"Alta — Urgente"},
                {value:"media",label:"Média — Importante"},
                {value:"baixa",label:"Baixa — Desejável"},
              ]}/>
              <Select label="Categoria" value={novaAcao.categoria} onChange={(v:string)=>setNovaAcao({...novaAcao,categoria:v})} options={[
                {value:"financeiro",label:"Financeiro — Custos, caixa, dívidas"},
                {value:"comercial",label:"Comercial — Vendas, clientes, preços"},
                {value:"operacional",label:"Operacional — Processos, eficiência"},
                {value:"pessoas",label:"Pessoas — Equipe, treinamento"},
                {value:"estrategico",label:"Estratégico — Novos negócios, expansão"},
              ]}/>
              <div style={{gridColumn:"1/3"}}>
                <Input label="Impacto esperado" value={novaAcao.impacto_esperado} onChange={(v:string)=>setNovaAcao({...novaAcao,impacto_esperado:v})} placeholder="Ex: Redução de R$ 15K/mês nos custos de matéria-prima"/>
              </div>
              <div style={{gridColumn:"1/3"}}>
                <Input label="Observações" value={novaAcao.observacoes} onChange={(v:string)=>setNovaAcao({...novaAcao,observacoes:v})} placeholder="Detalhes, contexto, riscos..."/>
              </div>
            </div>
            <div style={{marginTop:12,display:"flex",justifyContent:"flex-end"}}>
              <Btn onClick={async()=>{
                if(!novaAcao.acao||!selectedCompany) { showToast("Preencha a descrição da ação","err"); return; }
                const { data: { user } } = await supabase.auth.getUser();
                if(!user) return;
                const { data: profile } = await supabase.from("users").select("org_id").eq("id",user.id).single();
                const { data, error } = await supabase.from("plano_acao").insert({
                  org_id: profile?.org_id,
                  company_id: selectedCompany,
                  ...novaAcao,
                  prazo: novaAcao.prazo||null,
                }).select().single();
                if(error) { showToast("Erro ao salvar: "+error.message,"err"); return; }
                setAcoes([...acoes, data]);
                setNovaAcao({acao:"",responsavel:"",prazo:"",prioridade:"media",categoria:"operacional",impacto_esperado:"",observacoes:""});
                showToast("Ação adicionada ao plano!","ok");
              }}>◆ Adicionar Ação</Btn>
            </div>
          </Card>

          {/* Resumo */}
          {acoes.length>0&&(
            <Card>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,textAlign:"center"}}>
                <div><div style={{fontSize:18,fontWeight:700,color:TX}}>{acoes.length}</div><div style={{fontSize:9,color:TXD}}>Total de ações</div></div>
                <div><div style={{fontSize:18,fontWeight:700,color:Y}}>{acoes.filter(a=>a.status==="em_andamento").length}</div><div style={{fontSize:9,color:TXD}}>Em andamento</div></div>
                <div><div style={{fontSize:18,fontWeight:700,color:G}}>{acoes.filter(a=>a.status==="concluida").length}</div><div style={{fontSize:9,color:TXD}}>Concluídas</div></div>
                <div><div style={{fontSize:18,fontWeight:700,color:R}}>{acoes.filter(a=>a.prazo&&new Date(a.prazo)<new Date()&&a.status!=="concluida").length}</div><div style={{fontSize:9,color:TXD}}>Atrasadas</div></div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* === INTEGRAÇÕES === */}
      {aba==="integracoes"&&(
        <div>
          <Card title="Conectar ERP — Importar dados automaticamente">
            <div style={{fontSize:11,color:TXM,marginBottom:14}}>Conecte o sistema de gestão da empresa para importar faturamento, custos, estoque e financeiro automaticamente — sem digitar nada.</div>
            
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[
                {id:"omie",nome:"Omie",status:"Disponível",cor:G},
                {id:"contaazul",nome:"ContaAzul",status:"Disponível",cor:G},
                {id:"bling",nome:"Bling",status:"Em breve",cor:Y},
                {id:"nenhum",nome:"Sem ERP (manual)",status:"Ativo",cor:TXM},
              ].map(erp=>(
                <button key={erp.id} onClick={()=>erp.id!=="bling"&&setOmieErp(erp.id)} style={{
                  flex:1,padding:"10px 8px",borderRadius:8,textAlign:"center",cursor:erp.id==="bling"?"default":"pointer",
                  border:`1px solid ${omieErp===erp.id?GO:BD}`,background:omieErp===erp.id?GO+"15":"transparent",opacity:erp.id==="bling"?0.5:1
                }}>
                  <div style={{fontSize:13,fontWeight:600,color:omieErp===erp.id?GOL:TX}}>{erp.nome}</div>
                  <div style={{fontSize:9,color:erp.cor,marginTop:2}}>{erp.status}</div>
                </button>
              ))}
            </div>
          </Card>

          {omieErp==="omie"&&(
            <Card title="Configuração do Omie">
              <div style={{fontSize:11,color:TXM,marginBottom:14}}>
                Para conectar, acesse o Omie da empresa: <strong style={{color:TX}}>Configurações → Integrações → API → Chaves de API</strong>. 
                Copie a App Key e o App Secret e cole abaixo.
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <Input label="App Key" value={omieKey} onChange={setOmieKey} placeholder="1234567890123"/>
                <Input label="App Secret" value={omieSecret} onChange={setOmieSecret} placeholder="abc123def456ghi789jkl"/>
              </div>

              {omieKey&&omieSecret&&(
                <div style={{marginTop:12}}>
                  <div style={{fontSize:11,color:TXM,marginBottom:8}}>Dados que serão importados:</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:12}}>
                    {["Dados da empresa","Categorias financeiras","Produtos cadastrados","Clientes e fornecedores",
                      "Contas a pagar","Contas a receber","Pedidos de venda faturados","Posição de estoque",
                      "Resumo financeiro","Contas bancárias"].map((item,i)=>(
                      <div key={i} style={{fontSize:10,color:TX,padding:"4px 8px",background:BG3,borderRadius:4}}>✓ {item}</div>
                    ))}
                  </div>

                  <div style={{display:"flex",gap:8}}>
                    <button onClick={async()=>{
                      setOmieStatus("syncing");
                      setOmieResult(null);
                      try {
                        // Test connection first
                        const testRes = await fetch("/api/omie", {
                          method: "POST",
                          headers: {"Content-Type":"application/json"},
                          body: JSON.stringify({
                            app_key: omieKey, app_secret: omieSecret,
                            endpoint: "geral/empresas/", method: "ListarEmpresas",
                            params: { pagina: 1, registros_por_pagina: 1 }
                          })
                        });
                        const testData = await testRes.json();
                        if(testData.faultstring) {
                          setOmieStatus("error");
                          setOmieResult({error: testData.faultstring});
                          return;
                        }
                        setOmieResult({test: "Conexão OK!", empresa: testData});
                        setOmieStatus("success");
                        showToast("Conexão com Omie estabelecida!","ok");
                      } catch(e:any) {
                        setOmieStatus("error");
                        setOmieResult({error: e.message});
                      }
                    }} disabled={omieStatus==="syncing"} style={{
                      padding:"10px 20px",borderRadius:8,border:`1px solid ${GO}`,
                      background:"transparent",color:GOL,fontSize:12,fontWeight:600,cursor:"pointer"
                    }}>
                      {omieStatus==="syncing"?"Conectando...":"◆ Testar Conexão"}
                    </button>

                    <button onClick={async()=>{
                      setOmieStatus("syncing");
                      setOmieResult(null);
                      try {
                        const res = await fetch("/api/omie/sync", {
                          method: "POST",
                          headers: {"Content-Type":"application/json"},
                          body: JSON.stringify({ app_key: omieKey, app_secret: omieSecret, sync_type: "all" })
                        });
                        const data = await res.json();
                        if(data.error) {
                          setOmieStatus("error");
                          setOmieResult({error: data.error});
                          return;
                        }
                        setOmieResult(data.data);
                        
                        // Save imported data to Supabase
                        if(selectedCompany && data.data) {
                          // Delete old imports for this company
                          await supabase.from("omie_imports").delete().eq("company_id", selectedCompany);
                          
                          // Save each data type
                          const imports = [];
                          if(data.data.categorias) imports.push({company_id:selectedCompany,import_type:"categorias",import_data:data.data.categorias,record_count:data.data.categorias.total_de_registros||0});
                          if(data.data.clientes) imports.push({company_id:selectedCompany,import_type:"clientes",import_data:data.data.clientes,record_count:data.data.clientes.total_de_registros||0});
                          if(data.data.produtos) imports.push({company_id:selectedCompany,import_type:"produtos",import_data:data.data.produtos,record_count:data.data.produtos.total_de_registros||0});
                          if(data.data.contas_pagar) imports.push({company_id:selectedCompany,import_type:"contas_pagar",import_data:data.data.contas_pagar,record_count:data.data.contas_pagar.total_de_registros||0});
                          if(data.data.contas_receber) imports.push({company_id:selectedCompany,import_type:"contas_receber",import_data:data.data.contas_receber,record_count:data.data.contas_receber.total_de_registros||0});
                          if(data.data.vendas) imports.push({company_id:selectedCompany,import_type:"vendas",import_data:data.data.vendas,record_count:data.data.vendas.total_de_registros||0});
                          if(data.data.estoque) imports.push({company_id:selectedCompany,import_type:"estoque",import_data:data.data.estoque,record_count:0});
                          if(data.data.resumo) imports.push({company_id:selectedCompany,import_type:"resumo",import_data:data.data.resumo,record_count:0});
                          if(data.data.empresa) imports.push({company_id:selectedCompany,import_type:"empresa",import_data:data.data.empresa,record_count:0});
                          
                          if(imports.length > 0) {
                            await supabase.from("omie_imports").insert(imports);
                          }
                          
                          // Save Omie credentials to company
                          await supabase.from("companies").update({
                            omie_app_key: omieKey,
                            omie_app_secret: omieSecret,
                            last_omie_sync: new Date().toISOString(),
                          }).eq("id", selectedCompany);
                        }
                        
                        setOmieStatus("success");
                        showToast("Dados importados e salvos no banco!","ok");
                      } catch(e:any) {
                        setOmieStatus("error");
                        setOmieResult({error: e.message});
                      }
                    }} disabled={omieStatus==="syncing"} style={{
                      padding:"10px 20px",borderRadius:8,border:"none",
                      background:`linear-gradient(135deg,${GO} 0%,${GOL} 100%)`,
                      color:"#0F0F0D",fontSize:12,fontWeight:600,cursor:"pointer"
                    }}>
                      {omieStatus==="syncing"?"Importando dados...":"◆ Importar Todos os Dados"}
                    </button>
                  </div>
                </div>
              )}

              {omieStatus==="error"&&omieResult?.error&&(
                <div style={{background:R+"15",borderRadius:8,padding:12,marginTop:12,border:`0.5px solid ${R}40`}}>
                  <div style={{fontSize:11,fontWeight:600,color:R}}>Erro na conexão</div>
                  <div style={{fontSize:10,color:TX,marginTop:4}}>{omieResult.error}</div>
                  <div style={{fontSize:9,color:TXM,marginTop:4}}>Verifique se as chaves estão corretas e se a API está habilitada no Omie.</div>
                </div>
              )}

              {omieStatus==="success"&&omieResult&&(
                <div style={{background:G+"15",borderRadius:8,padding:12,marginTop:12,border:`0.5px solid ${G}40`}}>
                  <div style={{fontSize:12,fontWeight:600,color:G,marginBottom:8}}>✓ Dados importados com sucesso!</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                    {omieResult.empresa&&<div style={{fontSize:10,color:TX}}>✓ Empresa identificada</div>}
                    {omieResult.categorias&&<div style={{fontSize:10,color:TX}}>✓ {omieResult.categorias.total_de_registros||"—"} categorias</div>}
                    {omieResult.produtos&&<div style={{fontSize:10,color:TX}}>✓ {omieResult.produtos.total_de_registros||"—"} produtos</div>}
                    {omieResult.clientes&&<div style={{fontSize:10,color:TX}}>✓ {omieResult.clientes.total_de_registros||"—"} clientes</div>}
                    {omieResult.contas_pagar&&<div style={{fontSize:10,color:TX}}>✓ {omieResult.contas_pagar.total_de_registros||"—"} contas a pagar</div>}
                    {omieResult.contas_receber&&<div style={{fontSize:10,color:TX}}>✓ {omieResult.contas_receber.total_de_registros||"—"} contas a receber</div>}
                    {omieResult.vendas&&<div style={{fontSize:10,color:TX}}>✓ {omieResult.vendas.total_de_registros||"—"} pedidos faturados</div>}
                    {omieResult.estoque&&<div style={{fontSize:10,color:TX}}>✓ Posição de estoque carregada</div>}
                    {omieResult.resumo&&<div style={{fontSize:10,color:TX}}>✓ Resumo financeiro OK</div>}
                  </div>
                </div>
              )}
            </Card>
          )}

          {omieErp==="nenhum"&&(
            <Card>
              <div style={{textAlign:"center",padding:16}}>
                <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:8}}>Modo Manual</div>
                <div style={{fontSize:11,color:TXM,lineHeight:1.7}}>Sem integração com ERP. Use as abas "Resultado / Mês" e "Custos Estrutura" para preencher os dados manualmente, ou importe via planilha.</div>
              </div>
            </Card>
          )}

          {omieErp==="contaazul"&&(
            <Card title="Configuração do ContaAzul">
              <div style={{fontSize:11,color:TXM,marginBottom:14,lineHeight:1.7}}>
                <strong style={{color:TX}}>Passo 1:</strong> Acesse <a href="https://developers.contaazul.com" target="_blank" style={{color:GOL}}>developers.contaazul.com</a> e crie uma aplicação. 
                Copie o <strong>Client ID</strong> e <strong>Client Secret</strong> abaixo.<br/>
                <strong style={{color:TX}}>Passo 2:</strong> Clique em "Autorizar no ContaAzul" — você será redirecionado para autorizar o acesso.<br/>
                <strong style={{color:TX}}>Passo 3:</strong> Após autorizar, os dados serão importados automaticamente.
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <Input label="Client ID" value={caClientId} onChange={setCaClientId} placeholder="Ex: 6as5ta9dop17eipm2d2fgruk5p"/>
                <Input label="Client Secret (cole COMPLETO)" value={caClientSecret} onChange={setCaClientSecret} placeholder="Cole o secret inteiro, não abrevie"/>
              </div>

              {caClientId&&caClientSecret&&!caToken&&(
                <button onClick={()=>{
                  // Store credentials for callback
                  try { sessionStorage.setItem("ca_creds", JSON.stringify({client_id:caClientId,client_secret:caClientSecret})); } catch{}
                  // Use the EXACT redirect_uri registered in ContaAzul developer portal
                  const redirectUri = `${window.location.origin}/api/contaazul/callback`;
                  const authUrl = `https://api.contaazul.com/auth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${caClientId}&scope=sales&state=${encodeURIComponent(btoa(JSON.stringify({ci:caClientId,cs:caClientSecret})))}`;
                  window.location.href = authUrl;
                }} style={{
                  width:"100%",padding:"14px",borderRadius:10,border:"none",fontSize:13,fontWeight:700,
                  background:"linear-gradient(135deg,#0EA5E9,#38BDF8)",color:"#0C0C0A",cursor:"pointer",marginBottom:12,
                }}>
                  🔗 Autorizar no ContaAzul
                </button>
              )}

              {caToken&&(
                <div>
                  <div style={{padding:"8px 12px",borderRadius:8,background:G+"10",border:`1px solid ${G}30`,marginBottom:12,fontSize:11,color:G,fontWeight:500}}>
                    ✅ Autorizado! Token obtido com sucesso.
                  </div>

                  <div style={{fontSize:11,color:TXD,marginBottom:8}}>Dados que serão importados:</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:6,marginBottom:14}}>
                    {[
                      {nome:"Contas a Receber",icon:"📥",cor:G},
                      {nome:"Contas a Pagar",icon:"📤",cor:R},
                      {nome:"Clientes",icon:"👥",cor:"#60A5FA"},
                      {nome:"Vendas",icon:"🛒",cor:GOL},
                      {nome:"Categorias",icon:"📁",cor:"#A78BFA"},
                    ].map(d=>(
                      <div key={d.nome} style={{padding:"8px 10px",borderRadius:8,background:BG3,border:`1px solid ${BD}`,display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:14}}>{d.icon}</span>
                        <span style={{fontSize:10,color:d.cor,fontWeight:500}}>{d.nome}</span>
                      </div>
                    ))}
                  </div>

                  <button onClick={async()=>{
                    setOmieStatus("syncing");setOmieResult(null);
                    try{
                      const sync=await fetch("/api/contaazul/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:caToken,sync_type:"all"})});
                      const syncR=await sync.json();
                      if(syncR.success){
                        const d=syncR.data;
                        const compId=selectedCompany;
                        if(d.contas_receber?.registros?.length>0){
                          await supabase.from("omie_imports").upsert({company_id:compId,import_type:"contas_receber",import_data:{conta_receber_cadastro:d.contas_receber.registros},record_count:d.contas_receber.total,imported_at:new Date().toISOString()},{onConflict:"company_id,import_type"});
                        }
                        if(d.contas_pagar?.registros?.length>0){
                          await supabase.from("omie_imports").upsert({company_id:compId,import_type:"contas_pagar",import_data:{conta_pagar_cadastro:d.contas_pagar.registros},record_count:d.contas_pagar.total,imported_at:new Date().toISOString()},{onConflict:"company_id,import_type"});
                        }
                        if(d.clientes?.registros?.length>0){
                          await supabase.from("omie_imports").upsert({company_id:compId,import_type:"clientes",import_data:{clientes_cadastro:d.clientes.registros},record_count:d.clientes.total,imported_at:new Date().toISOString()},{onConflict:"company_id,import_type"});
                        }
                        if(d.categorias?.registros?.length>0){
                          await supabase.from("omie_imports").upsert({company_id:compId,import_type:"categorias",import_data:{categoria_cadastro:d.categorias.registros},record_count:d.categorias.total,imported_at:new Date().toISOString()},{onConflict:"company_id,import_type"});
                        }
                        setOmieStatus("success");
                        setOmieResult({contas_receber:d.contas_receber?.total||0,contas_pagar:d.contas_pagar?.total||0,clientes:d.clientes?.total||0,vendas:d.vendas?.total||0,categorias:d.categorias?.total||0});
                      }else{setOmieStatus("error");setOmieResult({error:syncR.error});}
                    }catch(e:any){setOmieStatus("error");setOmieResult({error:e.message});}
                  }} disabled={omieStatus==="syncing"} style={{
                    width:"100%",padding:"14px",borderRadius:10,border:"none",fontSize:13,fontWeight:700,
                    background:omieStatus==="syncing"?"#3D3A30":"linear-gradient(135deg,#0EA5E9,#38BDF8)",
                    color:omieStatus==="syncing"?"#A8A498":"#0C0C0A",cursor:omieStatus==="syncing"?"default":"pointer",
                  }}>
                    {omieStatus==="syncing"?"Importando dados do ContaAzul...":"◆ Importar Dados do ContaAzul"}
                  </button>

                  {omieStatus==="success"&&omieResult&&(
                    <div style={{marginTop:12,padding:14,borderRadius:10,background:G+"10",border:`1px solid ${G}30`}}>
                      <div style={{fontSize:13,fontWeight:600,color:G,marginBottom:8}}>✅ Importação concluída!</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(100px, 1fr))",gap:6}}>
                        {[{l:"Contas a Receber",v:omieResult.contas_receber},{l:"Contas a Pagar",v:omieResult.contas_pagar},{l:"Clientes",v:omieResult.clientes},{l:"Vendas",v:omieResult.vendas},{l:"Categorias",v:omieResult.categorias}].map(x=>(
                          <div key={x.l} style={{textAlign:"center",padding:6,borderRadius:6,background:BG3}}>
                            <div style={{fontSize:16,fontWeight:700,color:G}}>{x.v}</div>
                            <div style={{fontSize:9,color:TXD}}>{x.l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {omieStatus==="error"&&omieResult&&(
                    <div style={{marginTop:12,padding:14,borderRadius:10,background:R+"10",border:`1px solid ${R}30`}}>
                      <div style={{fontSize:13,fontWeight:600,color:R}}>❌ Erro na importação</div>
                      <div style={{fontSize:11,color:TXM,marginTop:4}}>{omieResult.error}</div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {omieErp==="bling"&&(
            <Card>
              <div style={{textAlign:"center",padding:16}}>
                <div style={{fontSize:14,fontWeight:600,color:Y,marginBottom:8}}>Em desenvolvimento</div>
                <div style={{fontSize:11,color:TXM,lineHeight:1.7}}>A integração com Bling está em desenvolvimento e será disponibilizada em breve. Por enquanto, use o modo manual ou importe via planilha.</div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
