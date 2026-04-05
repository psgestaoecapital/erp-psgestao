"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0F0F0D",BG2="#1C1B18",BG3="#2A2822",
    G="#22C55E",R="#EF4444",Y="#FACC15",B="#3B82F6",
    BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#6B6960";

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
    {id:"prolabore",nome:"Pró-labore dos sócios"},
    {id:"folha_adm",nome:"Salários administrativos"},
    {id:"encargos",nome:"Encargos (INSS, FGTS)"},
    {id:"vr_va",nome:"Vale refeição / alimentação"},
    {id:"vt",nome:"Vale transporte"},
    {id:"plano_saude",nome:"Plano de saúde"},
    {id:"seguro_vida",nome:"Seguro de vida em grupo"},
    {id:"treinamentos",nome:"Treinamentos e capacitação"},
    {id:"uniformes_epi",nome:"Uniformes / EPIs"},
    {id:"ferias_13",nome:"Provisão férias e 13º"},
  ]},
  {grupo:"Ocupação",cor:"#A855F7",contas:[
    {id:"aluguel",nome:"Aluguel"},
    {id:"condominio",nome:"Condomínio"},
    {id:"iptu",nome:"IPTU"},
    {id:"energia",nome:"Energia elétrica"},
    {id:"agua",nome:"Água / esgoto"},
    {id:"manut_predial",nome:"Manutenção predial"},
    {id:"limpeza",nome:"Limpeza"},
    {id:"seguranca_monit",nome:"Segurança / monitoramento"},
  ]},
  {grupo:"Veículos e Deslocamento",cor:"#14B8A6",contas:[
    {id:"combustivel",nome:"Combustível"},
    {id:"manutencao_veic",nome:"Manutenção / revisões veículos"},
    {id:"seguro_veic",nome:"Seguro veicular"},
    {id:"ipva_licenc",nome:"IPVA / licenciamento"},
    {id:"pedagio_estac",nome:"Pedágio / estacionamento"},
    {id:"leasing_veic",nome:"Leasing / parcelas veículos"},
  ]},
  {grupo:"Tecnologia e Comunicação",cor:"#F97316",contas:[
    {id:"internet",nome:"Internet / telefonia"},
    {id:"softwares",nome:"Softwares e sistemas (ERP, CRM)"},
    {id:"hospedagem",nome:"Hospedagem / domínio web"},
    {id:"equip_ti",nome:"Equipamentos de TI"},
    {id:"suporte_ti",nome:"Suporte técnico"},
  ]},
  {grupo:"Administrativo e Assessorias",cor:"#C6973F",contas:[
    {id:"contabilidade",nome:"Contabilidade"},
    {id:"juridico",nome:"Assessoria jurídica"},
    {id:"financeiro_assess",nome:"Assessoria financeira"},
    {id:"despachante",nome:"Despachante / cartório"},
    {id:"material_escrit",nome:"Material de escritório"},
    {id:"correios",nome:"Correios / entregas"},
  ]},
  {grupo:"Comercial e Marketing",cor:"#22C55E",contas:[
    {id:"marketing_inst",nome:"Marketing institucional"},
    {id:"marketing_digital",nome:"Marketing digital"},
    {id:"taxas_cartao",nome:"Taxas de cartão de crédito/débito"},
    {id:"comissoes_banc",nome:"Comissões bancárias"},
    {id:"brindes",nome:"Brindes / amostras"},
    {id:"feiras_eventos",nome:"Feiras / eventos"},
    {id:"viagens_comerc",nome:"Viagens comerciais"},
  ]},
  {grupo:"Financeiro",cor:"#EF4444",contas:[
    {id:"juros_emprest",nome:"Juros de empréstimos"},
    {id:"parcelas_financ",nome:"Parcelas de financiamento"},
    {id:"parcelas_consorcio",nome:"Parcelas de consórcio"},
    {id:"tarifas_banc",nome:"Tarifas bancárias"},
    {id:"multas_juros",nome:"Multas / juros por atraso"},
  ]},
  {grupo:"Seguros",cor:"#FACC15",contas:[
    {id:"seguros",nome:"Seguro empresarial"},
    {id:"seguro_rc",nome:"Seguro RC profissional"},
    {id:"seguro_estoque",nome:"Seguro de estoque / mercadorias"},
  ]},
  {grupo:"Outros",cor:"#A8A498",contas:[
    {id:"depreciacao",nome:"Depreciação de equipamentos"},
    {id:"perdas_quebras",nome:"Perdas e quebras"},
    {id:"doacoes",nome:"Doações / patrocínios"},
    {id:"retiradas_extras",nome:"Retiradas extras dos sócios"},
    {id:"outros",nome:"Outros custos diversos"},
  ]},
];

export default function DadosPage() {
  const [aba, setAba] = useState("empresa");
  const [toast, setToast] = useState<{msg:string,tipo:"ok"|"err"}|null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [mesSel, setMesSel] = useState("2025-01");

  // M0 - Empresa
  const [empresa, setEmpresa] = useState({razao_social:"",nome_fantasia:"",cnpj:"",cidade_estado:"",setor:"",num_colaboradores:"",faturamento_anual:""});
  
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

  // Contexto Humano (Bloco 18)
  const [contexto, setContexto] = useState({
    problemas:"",mudancas_mercado:"",decisoes_pendentes:"",oportunidades:"",
    problemas_clientes:"",metas_sonhos:"",observacoes:""
  });

  useEffect(()=>{ loadCompanies(); }, []);

  const loadCompanies = async () => {
    const { data } = await supabase.from("companies").select("*").order("created_at",{ascending:false});
    if(data && data.length > 0) {
      setCompanies(data);
      setSelectedCompany(data[0].id);
      setEmpresa({
        razao_social: data[0].razao_social || "",
        nome_fantasia: data[0].nome_fantasia || "",
        cnpj: data[0].cnpj || "",
        cidade_estado: data[0].cidade_estado || "",
        setor: data[0].setor || "",
        num_colaboradores: data[0].num_colaboradores?.toString() || "",
        faturamento_anual: data[0].faturamento_anual?.toString() || "",
      });
      loadBusinessLines(data[0].id);
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
              <Select label="Empresa ativa" value={selectedCompany} onChange={(v:string)=>{
                setSelectedCompany(v);
                const c = companies.find(c=>c.id===v);
                if(c) {
                  setEmpresa({razao_social:c.razao_social||"",nome_fantasia:c.nome_fantasia||"",cnpj:c.cnpj||"",cidade_estado:c.cidade_estado||"",setor:c.setor||"",num_colaboradores:c.num_colaboradores?.toString()||"",faturamento_anual:c.faturamento_anual?.toString()||""});
                  loadBusinessLines(v);
                }
              }} options={companies.map(c=>({value:c.id,label:c.nome_fantasia||c.razao_social}))}/>
            </div>
            {(aba==="resultado"||aba==="estrutura")&&(
              <div style={{flex:1}}>
                <Select label="Mês de referência" value={mesSel} onChange={setMesSel} options={MESES}/>
              </div>
            )}
          </div>
        </Card>
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
        <Card title="Cadastro da Empresa">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Input label="Razão Social *" value={empresa.razao_social} onChange={(v:string)=>setEmpresa({...empresa,razao_social:v})} placeholder="Razão social completa"/>
            <Input label="Nome Fantasia" value={empresa.nome_fantasia} onChange={(v:string)=>setEmpresa({...empresa,nome_fantasia:v})} placeholder="Nome fantasia"/>
            <Input label="CNPJ" value={empresa.cnpj} onChange={(v:string)=>setEmpresa({...empresa,cnpj:v})} placeholder="00.000.000/0001-00"/>
            <Input label="Cidade / Estado" value={empresa.cidade_estado} onChange={(v:string)=>setEmpresa({...empresa,cidade_estado:v})} placeholder="Chapecó/SC"/>
            <Input label="Setor de Atuação" value={empresa.setor} onChange={(v:string)=>setEmpresa({...empresa,setor:v})} placeholder="Ex: Materiais Elétricos"/>
            <Input label="Nº de Colaboradores" value={empresa.num_colaboradores} onChange={(v:string)=>setEmpresa({...empresa,num_colaboradores:v})} type="number" placeholder="54"/>
            <Input label="Faturamento Anual Estimado" value={empresa.faturamento_anual} onChange={(v:string)=>setEmpresa({...empresa,faturamento_anual:v})} prefix="R$" type="number" placeholder="26000000"/>
          </div>
          <div style={{marginTop:16,display:"flex",justifyContent:"flex-end"}}>
            <Btn onClick={salvarEmpresa}>◆ Salvar Dados da Empresa</Btn>
          </div>
        </Card>
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
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <div style={{width:10,height:10,borderRadius:3,background:grupo.cor}}/>
                  <div style={{fontSize:13,fontWeight:600,color:grupo.cor}}>{grupo.grupo}</div>
                  <div style={{fontSize:10,color:TXD}}>({grupo.contas.filter(c=>custosAtivos[c.id]).length} ativas)</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {(mostrarTodos?grupo.contas:contasVisiveis).map(conta=>(
                    <div key={conta.id} style={{display:"flex",alignItems:"center",gap:8,background:custosAtivos[conta.id]?BG3:"transparent",borderRadius:6,padding:"6px 8px",border:`0.5px solid ${custosAtivos[conta.id]?BD:"transparent"}`}}>
                      <input type="checkbox" checked={!!custosAtivos[conta.id]} onChange={e=>{
                        setCustosAtivos({...custosAtivos,[conta.id]:e.target.checked});
                        if(!e.target.checked) { const n={...custos}; delete n[conta.id]; setCustos(n); }
                      }} style={{accentColor:GO}}/>
                      {custosAtivos[conta.id]?(
                        <div style={{flex:1,display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:11,color:TX,flex:1,minWidth:120}}>{conta.nome}</span>
                          <span style={{fontSize:10,color:TXD}}>R$</span>
                          <input type="number" value={custos[conta.id]||""} onChange={e=>setCustos({...custos,[conta.id]:e.target.value})}
                            placeholder="0" style={{background:BG2,border:`1px solid ${BD}`,color:TX,borderRadius:4,padding:"4px 8px",fontSize:12,width:100,textAlign:"right"}}/>
                        </div>
                      ):(
                        <span style={{fontSize:11,color:TXD}}>{conta.nome}</span>
                      )}
                    </div>
                  ))}
                </div>
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
    </div>
  );
}
