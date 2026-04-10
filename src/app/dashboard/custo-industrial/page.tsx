"use client";
import React, { useState } from "react";

const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",ow:"#FAF7F2",
  g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",
  bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};
const fR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fP=(v:number)=>`${v.toFixed(2)}%`;

// ═══ DADOS SIMULADOS — INDÚSTRIA DE ALIMENTOS ═══

const PRODUTOS=[
  {id:"P01",nome:"Linguiça Calabresa 1kg",ncm:"16010000",cfop:"5101",cst:"000",un:"KG",
   mp:[
    {item:"Carne suína (pernil)",qtd:0.55,un:"kg",custo:14.80,icms:12,pis:1.65,cofins:7.6},
    {item:"Toucinho",qtd:0.15,un:"kg",custo:8.20,icms:12,pis:1.65,cofins:7.6},
    {item:"Condimentos/temperos",qtd:0.025,un:"kg",custo:32.00,icms:18,pis:1.65,cofins:7.6},
    {item:"Tripa natural",qtd:0.8,un:"m",custo:2.50,icms:12,pis:1.65,cofins:7.6},
    {item:"Embalagem primária",qtd:1,un:"un",custo:0.85,icms:18,pis:1.65,cofins:7.6},
    {item:"Embalagem secundária (caixa)",qtd:0.1,un:"un",custo:3.20,icms:18,pis:1.65,cofins:7.6},
   ],
   mod:{horasKg:0.012,custoHora:28.50,encargos:0.78},
   gif:{energiaKg:0.42,aguaKg:0.08,manutKg:0.15,deprecKg:0.22,limpezaKg:0.10},
   fiscal:{icmsSaida:12,ipiSaida:0,pisSaida:1.65,cofinsSaida:7.6,icmsST:0},
   preco:24.90,volume:45000},
  {id:"P02",nome:"Salsicha Hot Dog 3kg",ncm:"16010000",cfop:"5101",cst:"000",un:"KG",
   mp:[
    {item:"CMS (carne mec. separada)",qtd:0.45,un:"kg",custo:6.80,icms:12,pis:1.65,cofins:7.6},
    {item:"Carne suína (paleta)",qtd:0.20,un:"kg",custo:12.50,icms:12,pis:1.65,cofins:7.6},
    {item:"Amido/fécula",qtd:0.08,un:"kg",custo:4.20,icms:18,pis:1.65,cofins:7.6},
    {item:"Água/gelo",qtd:0.15,un:"kg",custo:0.10,icms:0,pis:0,cofins:0},
    {item:"Condimentos",qtd:0.02,un:"kg",custo:35.00,icms:18,pis:1.65,cofins:7.6},
    {item:"Tripa celulósica",qtd:1.2,un:"m",custo:0.45,icms:18,pis:1.65,cofins:7.6},
    {item:"Embalagem (saco 3kg)",qtd:0.33,un:"un",custo:1.20,icms:18,pis:1.65,cofins:7.6},
   ],
   mod:{horasKg:0.008,custoHora:26.00,encargos:0.78},
   gif:{energiaKg:0.38,aguaKg:0.12,manutKg:0.12,deprecKg:0.18,limpezaKg:0.08},
   fiscal:{icmsSaida:12,ipiSaida:0,pisSaida:1.65,cofinsSaida:7.6,icmsST:0},
   preco:14.50,volume:82000},
  {id:"P03",nome:"Presunto Cozido Fatiado 200g",ncm:"16024900",cfop:"5101",cst:"000",un:"KG",
   mp:[
    {item:"Carne suína (pernil)",qtd:0.65,un:"kg",custo:14.80,icms:12,pis:1.65,cofins:7.6},
    {item:"Amido/proteína",qtd:0.10,un:"kg",custo:8.50,icms:18,pis:1.65,cofins:7.6},
    {item:"Água/salmoura",qtd:0.18,un:"kg",custo:0.50,icms:0,pis:0,cofins:0},
    {item:"Condimentos/aditivos",qtd:0.015,un:"kg",custo:45.00,icms:18,pis:1.65,cofins:7.6},
    {item:"Embalagem vácuo 200g",qtd:5,un:"un",custo:0.35,icms:18,pis:1.65,cofins:7.6},
    {item:"Caixa master",qtd:0.05,un:"un",custo:4.50,icms:18,pis:1.65,cofins:7.6},
   ],
   mod:{horasKg:0.018,custoHora:30.00,encargos:0.78},
   gif:{energiaKg:0.55,aguaKg:0.10,manutKg:0.18,deprecKg:0.28,limpezaKg:0.12},
   fiscal:{icmsSaida:12,ipiSaida:0,pisSaida:1.65,cofinsSaida:7.6,icmsST:0},
   preco:38.90,volume:18000},
  {id:"P04",nome:"Mortadela Bologna 500g",ncm:"16010000",cfop:"5101",cst:"000",un:"KG",
   mp:[
    {item:"CMS suína",qtd:0.40,un:"kg",custo:6.80,icms:12,pis:1.65,cofins:7.6},
    {item:"Carne bovina (dianteiro)",qtd:0.15,un:"kg",custo:18.50,icms:12,pis:1.65,cofins:7.6},
    {item:"Toucinho",qtd:0.15,un:"kg",custo:8.20,icms:12,pis:1.65,cofins:7.6},
    {item:"Amido/fécula",qtd:0.10,un:"kg",custo:4.20,icms:18,pis:1.65,cofins:7.6},
    {item:"Água/gelo",qtd:0.12,un:"kg",custo:0.10,icms:0,pis:0,cofins:0},
    {item:"Condimentos",qtd:0.02,un:"kg",custo:38.00,icms:18,pis:1.65,cofins:7.6},
    {item:"Embalagem 500g",qtd:2,un:"un",custo:0.42,icms:18,pis:1.65,cofins:7.6},
   ],
   mod:{horasKg:0.010,custoHora:27.00,encargos:0.78},
   gif:{energiaKg:0.40,aguaKg:0.10,manutKg:0.14,deprecKg:0.20,limpezaKg:0.09},
   fiscal:{icmsSaida:12,ipiSaida:0,pisSaida:1.65,cofinsSaida:7.6,icmsST:0},
   preco:16.80,volume:55000},
];

function calcProduto(p: typeof PRODUTOS[0]){
  // MATÉRIA-PRIMA
  const mpTotal=p.mp.reduce((s,m)=>s+m.qtd*m.custo,0);
  const mpIcmsCredito=p.mp.reduce((s,m)=>s+m.qtd*m.custo*m.icms/100,0);
  const mpPisCredito=p.mp.reduce((s,m)=>s+m.qtd*m.custo*m.pis/100,0);
  const mpCofinsCredito=p.mp.reduce((s,m)=>s+m.qtd*m.custo*m.cofins/100,0);
  
  // MÃO DE OBRA DIRETA
  const modTotal=p.mod.horasKg*p.mod.custoHora*(1+p.mod.encargos);
  
  // GASTOS INDIRETOS DE FABRICAÇÃO
  const gifTotal=p.gif.energiaKg+p.gif.aguaKg+p.gif.manutKg+p.gif.deprecKg+p.gif.limpezaKg;
  
  // CUSTO INDUSTRIAL
  const custoIndustrial=mpTotal+modTotal+gifTotal;
  
  // TRIBUTOS SOBRE VENDA
  const icmsDebito=p.preco*p.fiscal.icmsSaida/100;
  const ipiDebito=p.preco*p.fiscal.ipiSaida/100;
  const pisDebito=p.preco*p.fiscal.pisSaida/100;
  const cofinsDebito=p.preco*p.fiscal.cofinsSaida/100;
  
  // CRÉDITOS TRIBUTÁRIOS
  const icmsLiquido=icmsDebito-mpIcmsCredito;
  const pisLiquido=pisDebito-mpPisCredito;
  const cofinsLiquido=cofinsDebito-mpCofinsCredito;
  const cargaTribTotal=icmsLiquido+ipiDebito+pisLiquido+cofinsLiquido;
  
  // DESPESAS COMERCIAIS (estimativas)
  const comissao=p.preco*0.03;
  const frete=p.preco*0.04;
  const despComercial=comissao+frete;
  
  // MARGENS
  const custoTotal=custoIndustrial+cargaTribTotal+despComercial;
  const lucroUnitario=p.preco-custoTotal;
  const margemBruta=(p.preco-custoIndustrial)/p.preco*100;
  const margemLiquida=lucroUnitario/p.preco*100;
  const markup=(p.preco/custoIndustrial-1)*100;
  
  // PONTO DE EQUILÍBRIO
  const mcUnitaria=p.preco-mpTotal-modTotal-(cargaTribTotal+despComercial);
  const custoFixoMensal=gifTotal*p.volume;
  const peUnidades=mcUnitaria>0?Math.ceil(custoFixoMensal/mcUnitaria):0;
  
  return{mpTotal,mpIcmsCredito,mpPisCredito,mpCofinsCredito,modTotal,gifTotal,custoIndustrial,
    icmsDebito,ipiDebito,pisDebito,cofinsDebito,icmsLiquido,pisLiquido,cofinsLiquido,cargaTribTotal,
    comissao,frete,despComercial,custoTotal,lucroUnitario,margemBruta,margemLiquida,markup,
    mcUnitaria,custoFixoMensal,peUnidades};
}

const Card=({children,title,color=C.gol}:{children:React.ReactNode;title?:string;color?:string})=>(
  <div style={{background:C.bg2,borderRadius:12,padding:14,border:`1px solid ${C.bd}`,marginBottom:12}}>
    {title&&<div style={{fontSize:13,fontWeight:700,color,marginBottom:10}}>{title}</div>}
    {children}
  </div>
);

const Row=({label,value,color=C.tx,bold,indent,bg}:{label:string;value:string;color?:string;bold?:boolean;indent?:boolean;bg?:string})=>(
  <div style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",paddingLeft:indent?"24px":"6px",borderBottom:`0.5px solid ${C.bd}30`,background:bg||"transparent"}}>
    <span style={{fontSize:10,color:bold?color:C.txm,fontWeight:bold?700:400}}>{label}</span>
    <span style={{fontSize:10,color,fontWeight:bold?700:400}}>{value}</span>
  </div>
);

export default function CustoIndustrialPage(){
  const [selectedId,setSelectedId]=useState(PRODUTOS[0].id);
  const [tab,setTab]=useState<"ficha"|"fiscal"|"margem"|"comparativo"|"simulador">("ficha");
  const [simPreco,setSimPreco]=useState(0);
  
  const produto=PRODUTOS.find(p=>p.id===selectedId)||PRODUTOS[0];
  const calc=calcProduto(produto);
  const tabs=[
    {id:"ficha" as const,label:"📋 Ficha de Custo",color:C.gol},
    {id:"fiscal" as const,label:"🏛️ Fiscal/Tributário",color:C.p},
    {id:"margem" as const,label:"📊 Margens",color:C.g},
    {id:"comparativo" as const,label:"🏭 Comparativo",color:C.b},
    {id:"simulador" as const,label:"🎯 Simulador",color:C.or},
  ];

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {/* HEADER */}
      <div style={{background:C.esp,padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:C.gol}}>PS Gestão — Custo Industrial Integrado</div>
          <div style={{fontSize:10,color:C.txm}}>Legislação Tributária + Gerencial | Margem por Produto | Dados Simulados</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setSimPreco(0);}} style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.gol,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600}}>
            {PRODUTOS.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"6px 12px",border:`1px solid ${C.bd}`,borderRadius:8,color:C.tx,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:2,padding:"8px 16px",background:C.bg2,overflowX:"auto",borderBottom:`1px solid ${C.bd}`}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:10,fontWeight:tab===t.id?700:500,
            background:tab===t.id?t.color+"20":"transparent",color:tab===t.id?t.color:C.txm,whiteSpace:"nowrap"}}>{t.label}</button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:1200,margin:"0 auto"}}>
        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:14}}>
          {[
            {l:"Custo Industrial",v:fR(calc.custoIndustrial),c:C.y},
            {l:"Preço Venda",v:fR(produto.preco),c:C.g},
            {l:"Margem Bruta",v:fP(calc.margemBruta),c:calc.margemBruta>=30?C.g:calc.margemBruta>=20?C.y:C.r},
            {l:"Margem Líquida",v:fP(calc.margemLiquida),c:calc.margemLiquida>=15?C.g:calc.margemLiquida>=8?C.y:C.r},
            {l:"Markup",v:fP(calc.markup),c:calc.markup>=40?C.g:calc.markup>=25?C.y:C.r},
            {l:"Lucro/kg",v:fR(calc.lucroUnitario),c:calc.lucroUnitario>0?C.g:C.r},
          ].map((k,i)=>(
            <div key={i} style={{background:C.bg2,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${k.c}`}}>
              <div style={{fontSize:7,color:C.txd,textTransform:"uppercase"}}>{k.l}</div>
              <div style={{fontSize:16,fontWeight:700,color:k.c}}>{k.v}</div>
            </div>
          ))}
        </div>

        {/* ═══ FICHA DE CUSTO ═══ */}
        {tab==="ficha"&&(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Card title="📦 Matéria-Prima / Insumos">
            <div style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",borderBottom:`1px solid ${C.bd}`,marginBottom:4}}>
              <span style={{fontSize:9,color:C.gol,fontWeight:600}}>Item</span>
              <div style={{display:"flex",gap:20}}>
                <span style={{fontSize:9,color:C.gol,width:50,textAlign:"right"}}>Qtd</span>
                <span style={{fontSize:9,color:C.gol,width:70,textAlign:"right"}}>R$/un</span>
                <span style={{fontSize:9,color:C.gol,width:70,textAlign:"right"}}>Custo</span>
              </div>
            </div>
            {produto.mp.map((m,i)=>{
              const custo=m.qtd*m.custo;
              return(
                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",borderBottom:`0.5px solid ${C.bd}20`}}>
                  <span style={{fontSize:10,color:C.tx}}>{m.item}</span>
                  <div style={{display:"flex",gap:20}}>
                    <span style={{fontSize:9,color:C.txm,width:50,textAlign:"right"}}>{m.qtd} {m.un}</span>
                    <span style={{fontSize:9,color:C.txm,width:70,textAlign:"right"}}>{fR(m.custo)}</span>
                    <span style={{fontSize:10,color:C.y,fontWeight:600,width:70,textAlign:"right"}}>{fR(custo)}</span>
                  </div>
                </div>
              );
            })}
            <Row label="TOTAL MATÉRIA-PRIMA" value={fR(calc.mpTotal)} color={C.y} bold bg={C.y+"08"}/>
          </Card>

          <div>
            <Card title="👷 Mão de Obra Direta (MOD)">
              <Row label="Horas por kg" value={`${produto.mod.horasKg} h`} indent/>
              <Row label="Custo hora" value={fR(produto.mod.custoHora)} indent/>
              <Row label="Encargos" value={fP(produto.mod.encargos*100)} indent/>
              <Row label="TOTAL MOD / kg" value={fR(calc.modTotal)} color={C.b} bold bg={C.b+"08"}/>
            </Card>

            <Card title="🏭 Gastos Indiretos de Fabricação (GIF)">
              <Row label="Energia elétrica" value={fR(produto.gif.energiaKg)} indent/>
              <Row label="Água / vapor" value={fR(produto.gif.aguaKg)} indent/>
              <Row label="Manutenção" value={fR(produto.gif.manutKg)} indent/>
              <Row label="Depreciação" value={fR(produto.gif.deprecKg)} indent/>
              <Row label="Limpeza / higienização" value={fR(produto.gif.limpezaKg)} indent/>
              <Row label="TOTAL GIF / kg" value={fR(calc.gifTotal)} color={C.p} bold bg={C.p+"08"}/>
            </Card>

            <Card>
              <Row label="= CUSTO INDUSTRIAL / kg" value={fR(calc.custoIndustrial)} color={C.gol} bold bg={C.go+"15"}/>
              <div style={{fontSize:9,color:C.txd,padding:"4px 6px"}}>MP ({fP(calc.mpTotal/calc.custoIndustrial*100)}) + MOD ({fP(calc.modTotal/calc.custoIndustrial*100)}) + GIF ({fP(calc.gifTotal/calc.custoIndustrial*100)})</div>
            </Card>
          </div>
        </div>)}

        {/* ═══ FISCAL / TRIBUTÁRIO ═══ */}
        {tab==="fiscal"&&(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Card title="🏛️ Débitos (sobre venda)">
            <div style={{fontSize:9,color:C.txd,marginBottom:8}}>NCM: {produto.ncm} | CFOP: {produto.cfop} | CST: {produto.cst} | Preço: {fR(produto.preco)}/kg</div>
            <Row label="ICMS Débito" value={`${fR(calc.icmsDebito)} (${produto.fiscal.icmsSaida}%)`} color={C.r}/>
            <Row label="IPI Débito" value={`${fR(calc.ipiDebito)} (${produto.fiscal.ipiSaida}%)`}/>
            <Row label="PIS Débito" value={`${fR(calc.pisDebito)} (${produto.fiscal.pisSaida}%)`} color={C.r}/>
            <Row label="COFINS Débito" value={`${fR(calc.cofinsDebito)} (${produto.fiscal.cofinsSaida}%)`} color={C.r}/>
            <Row label="TOTAL DÉBITOS" value={fR(calc.icmsDebito+calc.ipiDebito+calc.pisDebito+calc.cofinsDebito)} color={C.r} bold bg={C.r+"08"}/>
          </Card>

          <Card title="✅ Créditos (sobre compras de MP)">
            <Row label="ICMS Crédito (MP)" value={fR(calc.mpIcmsCredito)} color={C.g}/>
            <Row label="PIS Crédito (MP)" value={fR(calc.mpPisCredito)} color={C.g}/>
            <Row label="COFINS Crédito (MP)" value={fR(calc.mpCofinsCredito)} color={C.g}/>
            <Row label="TOTAL CRÉDITOS" value={fR(calc.mpIcmsCredito+calc.mpPisCredito+calc.mpCofinsCredito)} color={C.g} bold bg={C.g+"08"}/>
          </Card>

          <Card title="📊 Carga Tributária Líquida por kg">
            <Row label="ICMS Líquido (Débito - Crédito)" value={fR(calc.icmsLiquido)} color={calc.icmsLiquido>0?C.r:C.g}/>
            <Row label="IPI Líquido" value={fR(calc.ipiDebito)}/>
            <Row label="PIS Líquido" value={fR(calc.pisLiquido)} color={calc.pisLiquido>0?C.r:C.g}/>
            <Row label="COFINS Líquido" value={fR(calc.cofinsLiquido)} color={calc.cofinsLiquido>0?C.r:C.g}/>
            <Row label="CARGA TRIBUTÁRIA TOTAL / kg" value={fR(calc.cargaTribTotal)} color={C.r} bold bg={C.r+"08"}/>
            <Row label="% sobre preço de venda" value={fP(calc.cargaTribTotal/produto.preco*100)} color={C.r}/>
          </Card>

          <Card title="💡 Análise Fiscal IA">
            <div style={{fontSize:10,color:C.gol,lineHeight:1.8,fontStyle:"italic"}}>
              Carga tributária de {fP(calc.cargaTribTotal/produto.preco*100)} sobre o preço.
              {calc.mpIcmsCredito>0&&` Crédito de ICMS de ${fR(calc.mpIcmsCredito)}/kg sobre MP — verificar se todos os fornecedores emitem NF-e com destaque correto.`}
              {calc.cargaTribTotal/produto.preco>0.15&&` ⚠️ Carga acima de 15% — avaliar incentivos fiscais estaduais (PRODEC/SC, TTD) para redução de ICMS.`}
              {produto.fiscal.ipiSaida===0&&` IPI zero (NCM ${produto.ncm}) — confirmar enquadramento na TIPI vigente.`}
            </div>
          </Card>
        </div>)}

        {/* ═══ MARGENS ═══ */}
        {tab==="margem"&&(<Card title="📊 Formação de Preço e Margens">
          <div style={{maxWidth:600}}>
            <Row label="Preço de Venda" value={fR(produto.preco)} color={C.g} bold bg={C.g+"08"}/>
            <Row label="(-) Matéria-Prima" value={`(${fR(calc.mpTotal)})`} color={C.y} indent/>
            <Row label="(-) Mão de Obra Direta" value={`(${fR(calc.modTotal)})`} color={C.b} indent/>
            <Row label="(-) Gastos Indiretos Fab." value={`(${fR(calc.gifTotal)})`} color={C.p} indent/>
            <Row label="= CUSTO INDUSTRIAL" value={fR(calc.custoIndustrial)} color={C.gol} bold bg={C.go+"10"}/>
            <Row label="= MARGEM BRUTA" value={`${fR(produto.preco-calc.custoIndustrial)} (${fP(calc.margemBruta)})`} color={calc.margemBruta>=30?C.g:C.y} bold/>
            <div style={{height:8}}/>
            <Row label="(-) ICMS líquido" value={`(${fR(calc.icmsLiquido)})`} color={C.r} indent/>
            <Row label="(-) PIS líquido" value={`(${fR(calc.pisLiquido)})`} color={C.r} indent/>
            <Row label="(-) COFINS líquido" value={`(${fR(calc.cofinsLiquido)})`} color={C.r} indent/>
            <Row label="(-) IPI" value={`(${fR(calc.ipiDebito)})`} indent/>
            <Row label="= SUBTOTAL TRIBUTÁRIO" value={`(${fR(calc.cargaTribTotal)})`} color={C.r} bold/>
            <div style={{height:8}}/>
            <Row label="(-) Comissão (3%)" value={`(${fR(calc.comissao)})`} indent/>
            <Row label="(-) Frete (4%)" value={`(${fR(calc.frete)})`} indent/>
            <Row label="= DESP. COMERCIAIS" value={`(${fR(calc.despComercial)})`} color={C.or} bold/>
            <div style={{height:8}}/>
            <Row label="= CUSTO TOTAL / kg" value={fR(calc.custoTotal)} color={C.y} bold bg={C.y+"08"}/>
            <Row label="= LUCRO LÍQUIDO / kg" value={fR(calc.lucroUnitario)} color={calc.lucroUnitario>0?C.g:C.r} bold bg={calc.lucroUnitario>0?C.g+"08":C.r+"08"}/>
            <Row label="= MARGEM LÍQUIDA" value={fP(calc.margemLiquida)} color={calc.margemLiquida>0?C.g:C.r} bold/>
            <Row label="= MARKUP" value={fP(calc.markup)} color={C.gol} bold/>
            <div style={{height:8}}/>
            <Row label="Volume mensal" value={`${produto.volume.toLocaleString()} kg`}/>
            <Row label="Faturamento mensal" value={fR(produto.preco*produto.volume)} color={C.g} bold/>
            <Row label="Lucro mensal" value={fR(calc.lucroUnitario*produto.volume)} color={calc.lucroUnitario>0?C.g:C.r} bold/>
          </div>
        </Card>)}

        {/* ═══ COMPARATIVO ═══ */}
        {tab==="comparativo"&&(<Card title="🏭 Comparativo de Todos os Produtos">
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
              <thead><tr style={{borderBottom:`2px solid ${C.go}40`}}>
                {["Produto","Custo Ind.","Preço","Marg. Bruta","Trib. Líq.","Desp. Com.","Custo Total","Lucro/kg","Marg. Líq.","Markup","Volume","Lucro/mês"].map(h=>
                  <th key={h} style={{padding:"8px 6px",textAlign:h==="Produto"?"left":"right",color:C.gol,fontSize:9}}>{h}</th>
                )}
              </tr></thead>
              <tbody>
                {PRODUTOS.map(p=>{
                  const c=calcProduto(p);
                  return(
                    <tr key={p.id} style={{borderBottom:`0.5px solid ${C.bd}30`,cursor:"pointer",background:p.id===selectedId?C.go+"10":"transparent"}}
                      onClick={()=>setSelectedId(p.id)}>
                      <td style={{padding:"6px",color:C.tx,fontWeight:600,maxWidth:180}}>{p.nome}</td>
                      <td style={{padding:"6px",textAlign:"right",color:C.y}}>{fR(c.custoIndustrial)}</td>
                      <td style={{padding:"6px",textAlign:"right",color:C.g}}>{fR(p.preco)}</td>
                      <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:c.margemBruta>=30?C.g:c.margemBruta>=20?C.y:C.r}}>{fP(c.margemBruta)}</td>
                      <td style={{padding:"6px",textAlign:"right",color:C.r}}>{fR(c.cargaTribTotal)}</td>
                      <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{fR(c.despComercial)}</td>
                      <td style={{padding:"6px",textAlign:"right",color:C.y}}>{fR(c.custoTotal)}</td>
                      <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:c.lucroUnitario>0?C.g:C.r}}>{fR(c.lucroUnitario)}</td>
                      <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:c.margemLiquida>=15?C.g:c.margemLiquida>=8?C.y:C.r}}>{fP(c.margemLiquida)}</td>
                      <td style={{padding:"6px",textAlign:"right",color:C.gol}}>{fP(c.markup)}</td>
                      <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{(p.volume/1000).toFixed(0)}t</td>
                      <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:c.lucroUnitario>0?C.g:C.r}}>{fR(c.lucroUnitario*p.volume)}</td>
                    </tr>
                  );
                })}
                <tr style={{borderTop:`2px solid ${C.go}`,background:C.go+"10"}}>
                  <td style={{padding:"8px 6px",fontWeight:700,color:C.gol}}>TOTAL REDE</td>
                  <td colSpan={9}/>
                  <td style={{padding:"8px 6px",textAlign:"right",color:C.txm,fontWeight:600}}>{(PRODUTOS.reduce((s,p)=>s+p.volume,0)/1000).toFixed(0)}t</td>
                  <td style={{padding:"8px 6px",textAlign:"right",fontWeight:700,color:C.g}}>{fR(PRODUTOS.reduce((s,p)=>s+calcProduto(p).lucroUnitario*p.volume,0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>)}

        {/* ═══ SIMULADOR ═══ */}
        {tab==="simulador"&&(<Card title={`🎯 Simulador de Preço — ${produto.nome}`}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div>
              <div style={{fontSize:11,color:C.txm,marginBottom:8}}>Ajuste o preço de venda e veja o impacto:</div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
                <span style={{fontSize:10,color:C.txd}}>Preço atual: {fR(produto.preco)}</span>
                <input type="range" min={Math.round(calc.custoIndustrial*100)} max={Math.round(produto.preco*200)} value={simPreco||Math.round(produto.preco*100)}
                  onChange={e=>setSimPreco(parseInt(e.target.value))}
                  style={{flex:1}}/>
                <span style={{fontSize:14,fontWeight:700,color:C.gol}}>{fR((simPreco||produto.preco*100)/100)}</span>
              </div>
              {(()=>{
                const sp=(simPreco||produto.preco*100)/100;
                const sCalc=calcProduto({...produto,preco:sp});
                return(<>
                  <Row label="Preço simulado" value={fR(sp)} color={C.gol} bold/>
                  <Row label="Custo industrial" value={fR(sCalc.custoIndustrial)} color={C.y}/>
                  <Row label="Carga tributária" value={fR(sCalc.cargaTribTotal)} color={C.r}/>
                  <Row label="Desp. comerciais" value={fR(sCalc.despComercial)}/>
                  <Row label="Custo total" value={fR(sCalc.custoTotal)} color={C.y} bold/>
                  <div style={{height:8}}/>
                  <Row label="Lucro / kg" value={fR(sCalc.lucroUnitario)} color={sCalc.lucroUnitario>0?C.g:C.r} bold bg={sCalc.lucroUnitario>0?C.g+"08":C.r+"08"}/>
                  <Row label="Margem líquida" value={fP(sCalc.margemLiquida)} color={sCalc.margemLiquida>0?C.g:C.r} bold/>
                  <Row label="Markup" value={fP(sCalc.markup)} color={C.gol}/>
                  <Row label="Lucro mensal" value={fR(sCalc.lucroUnitario*produto.volume)} color={sCalc.lucroUnitario>0?C.g:C.r} bold/>
                  <div style={{height:8}}/>
                  <Row label="Variação vs atual" value={`${sp>produto.preco?"+":""}${fR(sp-produto.preco)} (${((sp/produto.preco-1)*100).toFixed(1)}%)`}
                    color={sp>=produto.preco?C.g:C.r} bold/>
                </>);
              })()}
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:C.or,marginBottom:8}}>Preços de referência:</div>
              {[
                {label:"Preço mínimo (custo total)",valor:calc.custoTotal,cor:C.r},
                {label:"Break-even (lucro zero)",valor:calc.custoTotal,cor:C.y},
                {label:"Margem 10%",valor:calc.custoTotal/0.90,cor:C.y},
                {label:"Margem 15%",valor:calc.custoTotal/0.85,cor:C.g},
                {label:"Margem 20%",valor:calc.custoTotal/0.80,cor:C.g},
                {label:"Preço atual",valor:produto.preco,cor:C.gol},
                {label:"Margem 25%",valor:calc.custoTotal/0.75,cor:C.g},
                {label:"Margem 30%",valor:calc.custoTotal/0.70,cor:C.g},
              ].map((ref,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",borderBottom:`0.5px solid ${C.bd}20`,cursor:"pointer",background:ref.label==="Preço atual"?C.go+"10":"transparent"}}
                  onClick={()=>setSimPreco(Math.round(ref.valor*100))}>
                  <span style={{fontSize:10,color:ref.cor}}>{ref.label}</span>
                  <span style={{fontSize:10,fontWeight:600,color:ref.cor}}>{fR(ref.valor)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>)}
      </div>
      <div style={{textAlign:"center",padding:12,fontSize:9,color:C.txd}}>PS Gestão e Capital — Custo Industrial Integrado v1.0 — Dados Simulados</div>
    </div>
  );
}
