"use client";
import React, { useState, useMemo } from "react";

// ═══ PS GESTÃO DESIGN SYSTEM ═══
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",ow:"#FAF7F2",
  g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",pk:"#EC4899",
  bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};
const fR=(v:number)=>`R$ ${Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fR2=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fP=(v:number)=>`${v.toFixed(1)}%`;
const sem=(v:number)=>v>=0?"🟢":"🔴";
const sem3=(v:number,m:number)=>v>=m?"🟢":v>=m*0.95?"🟡":"🔴";

// ═══ SIMULATED DATA: 10 PLANTS ═══
const PLANTS=[
  {id:"P01",nome:"Chapecó/SC",uf:"SC",abate:4200,rend:79.8,oee:86.2,custoKg:14.82,margem:16.1,he:4.2,otif:96,
   prodKgH:210,pessoas:420,faturamento:28500,desp:23900,frota:12,km:18400,diesel:4600,
   temp:[2.1,3.2,1.8,2.5,3.8,1.9],manut:98,mtbf:340,mttr:2.1,paradas:8},
  {id:"P02",nome:"Toledo/PR",uf:"PR",abate:5100,rend:80.2,oee:87.5,custoKg:14.35,margem:17.8,he:3.8,otif:97,
   prodKgH:225,pessoas:510,faturamento:35200,desp:28900,frota:15,km:22100,diesel:5520,
   temp:[1.8,2.9,2.1,2.2,3.1,1.5],manut:99,mtbf:380,mttr:1.8,paradas:5},
  {id:"P03",nome:"Concórdia/SC",uf:"SC",abate:3800,rend:78.5,oee:82.1,custoKg:15.40,margem:13.2,he:7.5,otif:92,
   prodKgH:185,pessoas:380,faturamento:24800,desp:21500,frota:10,km:15200,diesel:3950,
   temp:[2.4,3.5,2.8,4.2,3.9,2.2],manut:92,mtbf:280,mttr:3.2,paradas:14},
  {id:"P04",nome:"Videira/SC",uf:"SC",abate:3200,rend:79.1,oee:84.3,custoKg:15.10,margem:14.5,he:5.8,otif:94,
   prodKgH:195,pessoas:340,faturamento:21500,desp:18400,frota:8,km:12800,diesel:3200,
   temp:[1.9,2.8,2.0,2.3,3.2,1.7],manut:96,mtbf:320,mttr:2.4,paradas:9},
  {id:"P05",nome:"Dois Vizinhos/PR",uf:"PR",abate:4800,rend:80.5,oee:88.1,custoKg:14.15,margem:18.5,he:3.2,otif:98,
   prodKgH:230,pessoas:480,faturamento:33800,desp:27500,frota:14,km:20500,diesel:5100,
   temp:[1.5,2.4,1.8,2.0,2.8,1.3],manut:100,mtbf:420,mttr:1.5,paradas:3},
  {id:"P06",nome:"Passo Fundo/RS",uf:"RS",abate:3600,rend:78.8,oee:83.5,custoKg:15.25,margem:13.8,he:6.5,otif:93,
   prodKgH:190,pessoas:370,faturamento:23500,desp:20200,frota:9,km:14100,diesel:3680,
   temp:[2.2,3.1,2.5,3.8,3.5,2.0],manut:94,mtbf:290,mttr:2.8,paradas:12},
  {id:"P07",nome:"Erechim/RS",uf:"RS",abate:2800,rend:77.9,oee:80.2,custoKg:15.90,margem:11.5,he:9.2,otif:88,
   prodKgH:170,pessoas:310,faturamento:18200,desp:16100,frota:7,km:10500,diesel:2780,
   temp:[2.8,3.8,3.2,5.1,4.2,2.5],manut:88,mtbf:220,mttr:3.8,paradas:18},
  {id:"P08",nome:"Lucas do Rio Verde/MT",uf:"MT",abate:6200,rend:81.2,oee:89.3,custoKg:13.80,margem:19.8,he:2.8,otif:99,
   prodKgH:240,pessoas:580,faturamento:42800,desp:34300,frota:18,km:28500,diesel:7200,
   temp:[1.2,2.1,1.5,1.8,2.5,1.1],manut:100,mtbf:450,mttr:1.2,paradas:2},
  {id:"P09",nome:"Dourados/MS",uf:"MS",abate:4500,rend:79.5,oee:85.8,custoKg:14.65,margem:15.8,he:4.8,otif:95,
   prodKgH:205,pessoas:440,faturamento:29800,desp:25100,frota:13,km:19200,diesel:4850,
   temp:[2.0,3.0,2.2,2.8,3.4,1.8],manut:97,mtbf:330,mttr:2.2,paradas:7},
  {id:"P10",nome:"Rio Verde/GO",uf:"GO",abate:5500,rend:80.8,oee:88.8,custoKg:14.05,margem:18.2,he:3.0,otif:98,
   prodKgH:235,pessoas:530,faturamento:38200,desp:31200,frota:16,km:24800,diesel:6150,
   temp:[1.4,2.3,1.6,2.1,2.7,1.2],manut:99,mtbf:410,mttr:1.4,paradas:4},
];

const CORTES_SUINO=[
  {nome:"Pernil",pct:28.5,preco:18.90},{nome:"Paleta",pct:18.2,preco:14.50},{nome:"Lombo/Carré",pct:12.8,preco:24.80},
  {nome:"Costela",pct:11.5,preco:19.50},{nome:"Barriga/Panceta",pct:10.2,preco:22.30},{nome:"Toucinho",pct:8.5,preco:8.20},
  {nome:"Copa/Sobrepaleta",pct:5.8,preco:21.50},{nome:"Recortes/Aparas",pct:4.5,preco:9.80},
];

const SETORES=[
  {nome:"Pocilga/Recepção",pessoas:8,meta:null},{nome:"Abate/Sangria",pessoas:18,meta:280},
  {nome:"Escaldagem/Depilação",pessoas:12,meta:260},{nome:"Evisceração",pessoas:15,meta:270},
  {nome:"Desossa",pessoas:45,meta:165},{nome:"Industrialização",pessoas:22,meta:180},
  {nome:"Embalagem",pessoas:28,meta:420},{nome:"Câmaras Frias",pessoas:8,meta:null},
  {nome:"Expedição",pessoas:18,meta:500},{nome:"Manutenção",pessoas:12,meta:null},
  {nome:"Limpeza/Higiene",pessoas:15,meta:null},{nome:"Administrativo",pessoas:25,meta:null},
];

const CUSTO_COMPONENTES=[
  {nome:"Suíno vivo (compra)",valor:8.20,pct:56.0,meta:7.90,cor:C.r},
  {nome:"Mão de obra direta",valor:1.85,pct:12.6,meta:1.70,cor:C.b},
  {nome:"Embalagem",valor:0.92,pct:6.3,meta:0.88,cor:C.y},
  {nome:"Energia elétrica",valor:0.68,pct:4.6,meta:0.62,cor:C.y},
  {nome:"Água/Vapor/GLP",valor:0.45,pct:3.1,meta:0.42,cor:C.g},
  {nome:"Manutenção",valor:0.52,pct:3.5,meta:0.55,cor:C.g},
  {nome:"Logística/Frete",valor:0.48,pct:3.3,meta:0.42,cor:C.r},
  {nome:"Limpeza/Higienização",valor:0.35,pct:2.4,meta:0.35,cor:C.g},
  {nome:"Administrativo",valor:0.62,pct:4.2,meta:0.58,cor:C.y},
  {nome:"Impostos",valor:0.58,pct:4.0,meta:0.58,cor:C.g},
];

const FROTA_VEICULOS=[
  {placa:"ABC-1J23",tipo:"Truck Baú",km:4820,diesel:1205,entregas:48,kg:12400,tempMedia:2.1},
  {placa:"DEF-4K56",tipo:"Truck Baú",km:5210,diesel:1382,entregas:52,kg:14200,tempMedia:1.8},
  {placa:"GHI-7L89",tipo:"Truck Baú",km:3950,diesel:988,entregas:42,kg:10800,tempMedia:2.4},
  {placa:"JKL-2M34",tipo:"3/4 Refrig.",km:2180,diesel:364,entregas:38,kg:5200,tempMedia:2.8},
  {placa:"MNO-5N67",tipo:"3/4 Refrig.",km:1890,diesel:326,entregas:35,kg:4800,tempMedia:3.1},
  {placa:"PQR-8P90",tipo:"Utilitário",km:980,diesel:98,entregas:22,kg:1800,tempMedia:null},
];

const OEE_LINHAS=[
  {nome:"Linha Abate",disp:94.2,perf:96.1,qual:99.5,meta:90},
  {nome:"Linha Desossa",disp:86.5,perf:89.2,qual:98.8,meta:84},
  {nome:"Linha Embalagem",disp:91.8,perf:93.5,qual:99.7,meta:88},
  {nome:"Industrialização",disp:88.4,perf:90.8,qual:99.2,meta:85},
  {nome:"Câm. Resfriamento",disp:98.8,perf:null,qual:97.5,meta:96},
  {nome:"Túnel Congelamento",disp:95.5,perf:null,qual:99.0,meta:94},
];

const PARADAS_TOP=[
  {equip:"Serra de carcaça L1",tempo:"3h40",causa:"Lâmina desgastada",custo:8200,tipo:"Não programada"},
  {equip:"Esteira desossa L2",tempo:"2h15",causa:"Motor sobreaqueceu",custo:5800,tipo:"Não programada"},
  {equip:"Nória sangria",tempo:"1h50",causa:"Corrente travou",custo:4200,tipo:"Não programada"},
  {equip:"Escalda (vapor)",tempo:"1h20",causa:"Válvula vapor",custo:3100,tipo:"Não programada"},
  {equip:"Seladora embalagem",tempo:"0h55",causa:"Resistência queimou",custo:1800,tipo:"Não programada"},
];

const PCC_HACCP=[
  {pcc:"Temp. carcaça 24h",limite:"≤ 7°C",atual:"3.8°C",ok:true},
  {pcc:"pH carcaça 24h",limite:"5.6-6.2",atual:"5.9",ok:true},
  {pcc:"Temp. sala desossa",limite:"≤ 12°C",atual:"10.2°C",ok:true},
  {pcc:"Temp. produto final",limite:"≤ -18°C",atual:"-21.5°C",ok:true},
  {pcc:"Cloro água lavagem",limite:"0.5-2 ppm",atual:"1.1 ppm",ok:true},
  {pcc:"Temp. câmara 1",limite:"0-4°C",atual:"2.1°C",ok:true},
  {pcc:"Temp. câmara 2",limite:"0-4°C",atual:"3.8°C",ok:true},
  {pcc:"Temp. câmara 3",limite:"0-4°C",atual:"1.5°C",ok:true},
  {pcc:"Temp. câmara 4",limite:"0-4°C",atual:"4.8°C",ok:false},
  {pcc:"Temp. expedição",limite:"≤ 7°C",atual:"4.2°C",ok:true},
];

const FORNECEDORES=[
  {nome:"Granja São Jorge",cab:12500,peso:118,custo:7.85,mortalidade:0.8,conversao:2.42,score:95},
  {nome:"Agrop. Bela Vista",cab:9800,peso:121,custo:7.92,mortalidade:0.5,conversao:2.38,score:97},
  {nome:"Granja Três Irmãos",cab:8200,peso:115,custo:8.10,mortalidade:1.2,conversao:2.51,score:82},
  {nome:"Suínos Paraná",cab:7500,peso:120,custo:8.05,mortalidade:0.9,conversao:2.45,score:88},
  {nome:"Agrop. Santa Maria",cab:6800,peso:116,custo:8.25,mortalidade:1.5,conversao:2.58,score:75},
  {nome:"Compra spot",cab:4200,peso:112,custo:8.45,mortalidade:2.1,conversao:2.65,score:60},
];

// ═══ COMPONENTS ═══
const Card=({children,p="14px"}:{children:React.ReactNode;p?:string})=><div style={{background:C.bg2,borderRadius:12,padding:p,border:`1px solid ${C.bd}`}}>{children}</div>;
const KPI=({label,value,sub,color=C.gol,small}:{label:string;value:string;sub?:string;color?:string;small?:boolean})=>(
  <div style={{background:C.bg2,borderRadius:10,padding:small?"8px 10px":"10px 14px",borderLeft:`3px solid ${color}`}}>
    <div style={{fontSize:small?7:8,color:C.txd,textTransform:"uppercase",letterSpacing:0.5}}>{label}</div>
    <div style={{fontSize:small?16:22,fontWeight:700,color,marginTop:2}}>{value}</div>
    {sub&&<div style={{fontSize:small?7:8,color:C.txm,marginTop:1}}>{sub}</div>}
  </div>
);
const Sem=({v,m,inv}:{v:number;m:number;inv?:boolean})=>{const ok=inv?(v<=m):(v>=m);const warn=inv?(v<=m*1.05):(v>=m*0.95);return<span style={{color:ok?C.g:warn?C.y:C.r}}>{ok?"🟢":warn?"🟡":"🔴"}</span>;};

export default function IndustrialModule(){
  const [tab,setTab]=useState("ceo");
  const [plantId,setPlantId]=useState("ALL");
  
  const plant=plantId==="ALL"?null:PLANTS.find(p=>p.id===plantId);
  const totals=useMemo(()=>{
    const t:any={abate:0,faturamento:0,desp:0,pessoas:0,km:0,diesel:0,frota:0,paradas:0,rend:0,oee:0,custoKg:0,margem:0,he:0,otif:0,prodKgH:0};
    PLANTS.forEach(p=>{t.abate+=p.abate;t.faturamento+=p.faturamento;t.desp+=p.desp;t.pessoas+=p.pessoas;t.km+=p.km;t.diesel+=p.diesel;t.frota+=p.frota;t.paradas+=p.paradas;});
    t.rend=PLANTS.reduce((s,p)=>s+p.rend*p.abate,0)/t.abate;
    t.oee=PLANTS.reduce((s,p)=>s+p.oee*p.abate,0)/t.abate;
    t.custoKg=PLANTS.reduce((s,p)=>s+p.custoKg*p.abate,0)/t.abate;
    t.margem=(t.faturamento-t.desp)/t.faturamento*100;
    t.he=PLANTS.reduce((s,p)=>s+p.he*p.pessoas,0)/t.pessoas;
    t.otif=PLANTS.reduce((s,p)=>s+p.otif*p.frota,0)/t.frota;
    t.prodKgH=PLANTS.reduce((s,p)=>s+p.prodKgH*p.pessoas,0)/t.pessoas;
    return t;
  },[]);

  const tabs=[
    {id:"ceo",label:"📊 CEO",color:C.gol},{id:"bench",label:"🏭 Plantas",color:C.g},
    {id:"rend",label:"🥩 Rendimento",color:C.g},{id:"custo",label:"💰 Custo/kg",color:C.r},
    {id:"pessoas",label:"👥 Pessoas",color:C.b},{id:"frota",label:"🚛 Frota",color:C.y},
    {id:"oee",label:"⚙️ OEE",color:C.p},{id:"haccp",label:"🌡️ HACCP",color:C.cy},
    {id:"mp",label:"🐷 Compras",color:C.or},{id:"ia",label:"🤖 IA",color:C.gol},
  ];

  const d=plant||totals;

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {/* HEADER */}
      <div style={{background:C.esp,padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:C.gol}}>PS Gestão — Módulo Industrial</div>
          <div style={{fontSize:10,color:C.txm}}>SuínoBras S.A. — 10 Unidades Produtivas | Dados Simulados</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={plantId} onChange={e=>setPlantId(e.target.value)} style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.gol,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600}}>
            <option value="ALL">🏢 Todas as Plantas (Consolidado)</option>
            {PLANTS.map(p=><option key={p.id} value={p.id}>🏭 {p.nome}</option>)}
          </select>
          <div style={{background:C.bg3,borderRadius:8,padding:"6px 10px",fontSize:10,color:C.txm}}>Abril 2026</div>
        </div>
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:2,padding:"8px 16px",background:C.bg2,overflowX:"auto",borderBottom:`1px solid ${C.bd}`}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:10,fontWeight:tab===t.id?700:500,
            background:tab===t.id?t.color+"20":"transparent",color:tab===t.id?t.color:C.txm,whiteSpace:"nowrap"}}>{t.label}</button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:1400,margin:"0 auto"}}>

      {/* ═══ CEO DASHBOARD ═══ */}
      {tab==="ceo"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <KPI label="Abate Mensal" value={`${(d.abate||0).toLocaleString()} cab`} sub={plantId==="ALL"?"10 plantas":"Planta individual"} color={C.g}/>
          <KPI label="Rendimento" value={fP(d.rend)} sub="Meta: 80.0%" color={d.rend>=80?C.g:d.rend>=79?C.y:C.r}/>
          <KPI label="OEE Médio" value={fP(d.oee)} sub="Meta: 86%" color={d.oee>=86?C.g:d.oee>=83?C.y:C.r}/>
          <KPI label="Custo/kg" value={fR2(d.custoKg)} sub="Meta: R$ 14,50" color={d.custoKg<=14.5?C.g:d.custoKg<=15?C.y:C.r}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <KPI label="Faturamento" value={`R$ ${d.faturamento?.toLocaleString()}K`} sub={`Margem: ${fP(d.margem)}`} color={C.g}/>
          <KPI label="Produtividade" value={`${Math.round(d.prodKgH)} kg/h`} sub="Meta: 210 kg/h/pessoa" color={d.prodKgH>=210?C.g:d.prodKgH>=195?C.y:C.r}/>
          <KPI label="HE / Total" value={fP(d.he)} sub="Limite: 5%" color={d.he<=5?C.g:d.he<=7?C.y:C.r}/>
          <KPI label="OTIF Logística" value={fP(d.otif)} sub="Meta: 95%" color={d.otif>=95?C.g:d.otif>=90?C.y:C.r}/>
        </div>
        <Card>
          <div style={{fontSize:12,fontWeight:700,color:C.r,marginBottom:8}}>⚠️ Alertas IA — {plantId==="ALL"?"Consolidado":plant?.nome}</div>
          <div style={{fontSize:10,color:C.tx,lineHeight:1.8}}>
            <span style={{color:C.r}}>🔴</span> <b>Erechim/RS:</b> OEE 80.2% (pior da rede). 18 paradas não programadas. HE 9.2%. Recomendação: auditoria de manutenção + reforço equipe desossa.<br/>
            <span style={{color:C.r}}>🔴</span> <b>Câmara 4 (Concórdia):</b> Temperatura 4.8°C — acima do limite SIF. 3ª ocorrência. Urgente: verificar compressor.<br/>
            <span style={{color:C.y}}>🟡</span> <b>Concórdia/SC e Passo Fundo/RS:</b> Margem abaixo de 14%. Custos de MOD e logística acima das demais plantas.<br/>
            <span style={{color:C.g}}>🟢</span> <b>Lucas do Rio Verde/MT:</b> Melhor planta da rede em TODOS os indicadores. Benchmark: replicar práticas para demais unidades.
          </div>
        </Card>
      </>)}

      {/* ═══ BENCHMARK PLANTAS ═══ */}
      {tab==="bench"&&(<Card p="8px">
        <div style={{fontSize:13,fontWeight:700,color:C.gol,padding:"6px 8px"}}>Comparativo entre Plantas — Ranking por Margem</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr style={{borderBottom:`2px solid ${C.go}40`}}>
              {["#","Planta","UF","Abate","Rend%","OEE%","R$/kg","Margem","kg/h","HE%","OTIF","Score"].map(h=>
                <th key={h} style={{padding:"8px 6px",textAlign:h==="#"||h==="Planta"||h==="UF"?"left":"right",color:C.gol,fontSize:9}}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {[...PLANTS].sort((a,b)=>b.margem-a.margem).map((p,i)=>{
                const score=Math.round(p.margem*2+p.rend+p.oee/2-p.he*2+p.otif/5);
                const best=i===0,worst=i===PLANTS.length-1;
                return(
                  <tr key={p.id} style={{borderBottom:`0.5px solid ${C.bd}30`,background:best?C.g+"08":worst?C.r+"08":"transparent"}}>
                    <td style={{padding:"6px",color:best?C.g:worst?C.r:C.txm,fontWeight:700}}>{i+1}</td>
                    <td style={{padding:"6px",color:C.tx,fontWeight:600}}>{p.nome}</td>
                    <td style={{padding:"6px",color:C.txm}}>{p.uf}</td>
                    <td style={{padding:"6px",textAlign:"right",color:C.tx}}>{p.abate.toLocaleString()}</td>
                    <td style={{padding:"6px",textAlign:"right",color:p.rend>=80?C.g:p.rend>=79?C.y:C.r}}>{fP(p.rend)}</td>
                    <td style={{padding:"6px",textAlign:"right",color:p.oee>=86?C.g:p.oee>=83?C.y:C.r}}>{fP(p.oee)}</td>
                    <td style={{padding:"6px",textAlign:"right",color:p.custoKg<=14.5?C.g:p.custoKg<=15?C.y:C.r}}>{fR2(p.custoKg)}</td>
                    <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:p.margem>=16?C.g:p.margem>=14?C.y:C.r}}>{fP(p.margem)}</td>
                    <td style={{padding:"6px",textAlign:"right",color:p.prodKgH>=210?C.g:C.y}}>{p.prodKgH}</td>
                    <td style={{padding:"6px",textAlign:"right",color:p.he<=5?C.g:p.he<=7?C.y:C.r}}>{fP(p.he)}</td>
                    <td style={{padding:"6px",textAlign:"right",color:p.otif>=95?C.g:C.y}}>{p.otif}%</td>
                    <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:score>=180?C.g:score>=160?C.y:C.r}}>{score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>)}

      {/* ═══ RENDIMENTO ═══ */}
      {tab==="rend"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Card>
            <div style={{fontSize:12,fontWeight:700,color:C.gol,marginBottom:10}}>Rendimento de Carcaça Suína</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
              <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
                {["Indicador","Meta","Real","Status"].map(h=><th key={h} style={{padding:"6px",textAlign:h==="Indicador"?"left":"right",color:C.gol,fontSize:9}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[
                  {n:"Peso Vivo Médio",m:"118 kg",r:"116.5 kg"},{n:"Peso Carcaça Quente",m:"94.4 kg",r:"92.8 kg"},
                  {n:"Rendimento Quente",m:"80.0%",r:"79.7%"},{n:"Quebra de Frio",m:"1.5%",r:"1.8%"},
                  {n:"Peso Carcaça Fria",m:"93.0 kg",r:"91.1 kg"},{n:"Rendimento Final",m:"78.8%",r:"78.2%"},
                ].map((r,i)=>(
                  <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`}}>
                    <td style={{padding:"6px",color:C.tx}}>{r.n}</td>
                    <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{r.m}</td>
                    <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:C.tx}}>{r.r}</td>
                    <td style={{padding:"6px",textAlign:"right"}}>{i===3?"🔴":i<2?"🟡":"🟡"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <div style={{fontSize:12,fontWeight:700,color:C.gol,marginBottom:10}}>Mapa de Cortes (% carcaça fria)</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
              <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
                {["Corte","%","Preço/kg","Receita/cab"].map(h=><th key={h} style={{padding:"6px",textAlign:h==="Corte"?"left":"right",color:C.gol,fontSize:9}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {CORTES_SUINO.map((c,i)=>(
                  <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`}}>
                    <td style={{padding:"5px 6px",color:C.tx}}>{c.nome}</td>
                    <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>{fP(c.pct)}</td>
                    <td style={{padding:"5px 6px",textAlign:"right",color:C.g}}>{fR2(c.preco)}</td>
                    <td style={{padding:"5px 6px",textAlign:"right",fontWeight:600,color:C.gol}}>{fR2(91.1*c.pct/100*c.preco)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <Card p="10px"><div style={{fontSize:10,color:C.gol,fontStyle:"italic"}}>
          IA: "Quebra de frio 1.8% vs meta 1.5%. Impacto: R$ 82.000/mês em peso perdido. Câmara 4 de Concórdia com 3 alertas de temperatura. Ação: manutenção urgente compressor + revisão do ciclo de degelo automático."
        </div></Card>
      </>)}

      {/* ═══ CUSTO/KG ═══ */}
      {tab==="custo"&&(<Card>
        <div style={{fontSize:13,fontWeight:700,color:C.gol,marginBottom:10}}>Custo de Transformação por kg — {plantId==="ALL"?"Média Rede":plant?.nome}</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
            {["Componente","R$/kg","%","Meta","Var","Status"].map(h=><th key={h} style={{padding:"8px 6px",textAlign:h==="Componente"?"left":"right",color:C.gol,fontSize:9}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {CUSTO_COMPONENTES.map((c,i)=>{
              const varP=((c.valor/c.meta-1)*100);
              return(
                <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`,background:i===CUSTO_COMPONENTES.length-1?C.go+"10":"transparent"}}>
                  <td style={{padding:"6px",color:C.tx}}>{c.nome}</td>
                  <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:c.cor}}>{fR2(c.valor)}</td>
                  <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{fP(c.pct)}</td>
                  <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{fR2(c.meta)}</td>
                  <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:varP>5?C.r:varP>0?C.y:C.g}}>{varP>0?"+":""}{fP(varP)}</td>
                  <td style={{padding:"6px",textAlign:"right"}}>{varP<=0?"🟢":varP<=5?"🟡":"🔴"}</td>
                </tr>
              );
            })}
            <tr style={{borderTop:`2px solid ${C.go}`,background:C.go+"15"}}>
              <td style={{padding:"8px 6px",fontWeight:700,color:C.gol}}>CUSTO TOTAL / KG</td>
              <td style={{padding:"8px 6px",textAlign:"right",fontWeight:700,fontSize:14,color:C.r}}>{fR2(CUSTO_COMPONENTES.reduce((s,c)=>s+c.valor,0))}</td>
              <td style={{padding:"8px 6px",textAlign:"right",color:C.txm}}>100%</td>
              <td style={{padding:"8px 6px",textAlign:"right",color:C.txm}}>{fR2(CUSTO_COMPONENTES.reduce((s,c)=>s+c.meta,0))}</td>
              <td colSpan={2} style={{padding:"8px 6px",textAlign:"right",fontWeight:600,color:C.r}}>+{fP((CUSTO_COMPONENTES.reduce((s,c)=>s+c.valor,0)/CUSTO_COMPONENTES.reduce((s,c)=>s+c.meta,0)-1)*100)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
          <div style={{background:C.bg3,borderRadius:8,padding:10,borderLeft:`3px solid ${C.g}`}}>
            <div style={{fontSize:9,color:C.txd}}>PREÇO MÉDIO VENDA</div>
            <div style={{fontSize:20,fontWeight:700,color:C.g}}>R$ 17,45/kg</div>
          </div>
          <div style={{background:C.bg3,borderRadius:8,padding:10,borderLeft:`3px solid ${C.gol}`}}>
            <div style={{fontSize:9,color:C.txd}}>MARGEM POR KG</div>
            <div style={{fontSize:20,fontWeight:700,color:C.gol}}>R$ 2,80 (16.0%)</div>
          </div>
        </div>
      </Card>)}

      {/* ═══ PESSOAS ═══ */}
      {tab==="pessoas"&&(<Card>
        <div style={{fontSize:13,fontWeight:700,color:C.b,marginBottom:10}}>Pessoas e Produtividade por Setor</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
            {["Setor","Pessoas","kg/h/pessoa","Meta","HE Mês","Custo/kg MOD"].map(h=><th key={h} style={{padding:"6px",textAlign:h==="Setor"?"left":"right",color:C.b,fontSize:9}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {SETORES.map((st,i)=>{
              const he=Math.round(st.pessoas*(3+Math.random()*8));
              const real=st.meta?Math.round(st.meta*(0.88+Math.random()*0.15)):null;
              const custoKg=st.meta&&real?((st.pessoas*3200+he*48)/(real*st.pessoas*176)).toFixed(2):"-";
              return(
                <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`}}>
                  <td style={{padding:"5px 6px",color:C.tx}}>{st.nome}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>{st.pessoas}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",fontWeight:600,color:real&&st.meta?(real>=st.meta?C.g:real>=st.meta*0.9?C.y:C.r):C.txm}}>{real||"—"}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txd}}>{st.meta||"—"}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:he/st.pessoas>6?C.r:he/st.pessoas>4?C.y:C.g}}>{he}h ({fP(he/(st.pessoas*176)*100)})</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>R$ {custoKg}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>)}

      {/* ═══ FROTA ═══ */}
      {tab==="frota"&&(<Card>
        <div style={{fontSize:13,fontWeight:700,color:C.y,marginBottom:10}}>Frota e Logística</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
            {["Placa","Tipo","Km","Diesel(L)","km/L","Entregas","kg Total","R$/kg","Temp Baú"].map(h=><th key={h} style={{padding:"6px",textAlign:h==="Placa"||h==="Tipo"?"left":"right",color:C.y,fontSize:9}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {FROTA_VEICULOS.map((v,i)=>{
              const kml=(v.km/v.diesel).toFixed(2);const custoKg=((v.diesel*6.29+v.km*0.42)/(v.kg||1)).toFixed(2);
              return(
                <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`}}>
                  <td style={{padding:"5px 6px",color:C.tx,fontFamily:"monospace"}}>{v.placa}</td>
                  <td style={{padding:"5px 6px",color:C.txm}}>{v.tipo}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>{v.km.toLocaleString()}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>{v.diesel.toLocaleString()}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:parseFloat(kml)>=4?C.g:C.y}}>{kml}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>{v.entregas}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>{v.kg.toLocaleString()}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",fontWeight:600,color:parseFloat(custoKg)<=0.5?C.g:C.y}}>{custoKg}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:v.tempMedia!=null&&v.tempMedia<=3?C.g:v.tempMedia!=null&&v.tempMedia<=4?C.y:C.r}}>{v.tempMedia!=null?`${v.tempMedia}°C`:"N/A"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>)}

      {/* ═══ OEE ═══ */}
      {tab==="oee"&&(<>
        <Card>
          <div style={{fontSize:13,fontWeight:700,color:C.p,marginBottom:10}}>OEE por Linha de Produção</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
              {["Linha","Disponib.","Perform.","Qualidade","OEE","Meta","Status"].map(h=><th key={h} style={{padding:"8px 6px",textAlign:h==="Linha"?"left":"right",color:C.p,fontSize:9}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {OEE_LINHAS.map((l,i)=>{
                const oee=l.perf?l.disp/100*l.perf/100*l.qual/100*100:l.disp/100*l.qual/100*100;
                return(
                  <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`}}>
                    <td style={{padding:"6px",color:C.tx}}>{l.nome}</td>
                    <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{fP(l.disp)}</td>
                    <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{l.perf?fP(l.perf):"N/A"}</td>
                    <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{fP(l.qual)}</td>
                    <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:oee>=l.meta?C.g:oee>=l.meta*0.95?C.y:C.r}}>{fP(oee)}</td>
                    <td style={{padding:"6px",textAlign:"right",color:C.txd}}>{l.meta}%</td>
                    <td style={{padding:"6px",textAlign:"right"}}>{oee>=l.meta?"🟢":oee>=l.meta*0.95?"🟡":"🔴"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card p="10px">
          <div style={{fontSize:11,fontWeight:700,color:C.r,marginBottom:6}}>Top 5 Paradas Não Programadas</div>
          {PARADAS_TOP.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`0.5px solid ${C.bd}30`,fontSize:10}}>
              <span style={{color:C.tx}}>{i+1}. {p.equip} — <span style={{color:C.txm}}>{p.causa}</span></span>
              <span><span style={{color:C.r,fontWeight:600}}>{p.tempo}</span> <span style={{color:C.txm}}>({fR(p.custo)})</span></span>
            </div>
          ))}
        </Card>
      </>)}

      {/* ═══ HACCP ═══ */}
      {tab==="haccp"&&(<Card>
        <div style={{fontSize:13,fontWeight:700,color:C.cy,marginBottom:10}}>HACCP — Pontos Críticos de Controle</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
            {["PCC","Limite","Atual","Status"].map(h=><th key={h} style={{padding:"8px 6px",textAlign:h==="PCC"?"left":"right",color:C.cy,fontSize:9}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {PCC_HACCP.map((p,i)=>(
              <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`,background:!p.ok?C.r+"10":"transparent"}}>
                <td style={{padding:"6px",color:C.tx}}>{p.pcc}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{p.limite}</td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:p.ok?C.g:C.r}}>{p.atual}</td>
                <td style={{padding:"6px",textAlign:"right"}}>{p.ok?"🟢":"🔴"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!PCC_HACCP.every(p=>p.ok)&&(
          <div style={{marginTop:10,padding:10,background:C.r+"10",borderRadius:8,borderLeft:`3px solid ${C.r}`,fontSize:10,color:C.tx}}>
            <b style={{color:C.r}}>🔴 ALERTA CRÍTICO:</b> Câmara 4 com 4.8°C — acima do limite SIF de 4°C. 3ª ocorrência este mês. Ação: notificação enviada ao responsável. Verificar compressor e ciclo de degelo. Risco de interdição SIF.
          </div>
        )}
      </Card>)}

      {/* ═══ COMPRAS MP ═══ */}
      {tab==="mp"&&(<Card>
        <div style={{fontSize:13,fontWeight:700,color:C.or,marginBottom:10}}>Compra de Suínos — Score por Fornecedor</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
          <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
            {["Fornecedor","Cabeças","Peso Médio","R$/kg vivo","Mortalidade","Conv. Alimentar","Score"].map(h=><th key={h} style={{padding:"8px 6px",textAlign:h==="Fornecedor"?"left":"right",color:C.or,fontSize:9}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {FORNECEDORES.map((f,i)=>(
              <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}30`}}>
                <td style={{padding:"6px",color:C.tx}}>{f.nome}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{f.cab.toLocaleString()}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.txm}}>{f.peso} kg</td>
                <td style={{padding:"6px",textAlign:"right",color:f.custo<=8?C.g:f.custo<=8.2?C.y:C.r}}>{fR2(f.custo)}</td>
                <td style={{padding:"6px",textAlign:"right",color:f.mortalidade<=1?C.g:f.mortalidade<=1.5?C.y:C.r}}>{fP(f.mortalidade)}</td>
                <td style={{padding:"6px",textAlign:"right",color:f.conversao<=2.45?C.g:f.conversao<=2.55?C.y:C.r}}>{f.conversao}</td>
                <td style={{padding:"6px",textAlign:"right"}}>
                  <span style={{padding:"2px 8px",borderRadius:10,fontSize:9,fontWeight:700,
                    background:f.score>=90?C.g+"20":f.score>=80?C.y+"20":C.r+"20",
                    color:f.score>=90?C.g:f.score>=80?C.y:C.r}}>{f.score}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>)}

      {/* ═══ IA CONSULTOR ═══ */}
      {tab==="ia"&&(<>
        <Card>
          <div style={{fontSize:13,fontWeight:700,color:C.gol,marginBottom:10}}>🤖 IA Consultor Industrial</div>
          <div style={{background:C.bg3,borderRadius:8,padding:12,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:600,color:C.tx,marginBottom:8}}>CEO pergunta: "Por que a margem da rede caiu este mês?"</div>
          </div>
          <div style={{background:C.esp,borderRadius:8,padding:14,borderLeft:`3px solid ${C.go}`}}>
            <div style={{fontSize:11,fontWeight:700,color:C.gol,marginBottom:10}}>Diagnóstico IA com dados de 4 sistemas:</div>
            <div style={{fontSize:10,color:C.tx,lineHeight:2}}>
              A margem consolidada caiu de 17.2% para 16.0% (−1.2pp). Impacto: −R$ 3,8M/mês. As <b style={{color:C.r}}>3 causas principais</b>:<br/><br/>
              <b style={{color:C.r}}>1. Suíno vivo +3.8%</b> <span style={{color:C.txm}}>— Preço subiu de R$ 7,90 para R$ 8,20/kg (mercado). Impacto: +R$ 0,30/kg × 4,2M kg = R$ 1,26M/mês</span><br/>
              <b style={{color:C.y}}>2. Erechim/RS e Concórdia/SC puxando para baixo</b> <span style={{color:C.txm}}>— OEE 80.2% e 82.1% respectivamente. 32 paradas não programadas. HE 9.2% e 7.5%. Impacto: +R$ 0,45/kg nestas plantas</span><br/>
              <b style={{color:C.y}}>3. Logística +10%</b> <span style={{color:C.txm}}>— Diesel subiu 5% + 2 caminhões em manutenção (Passo Fundo e Erechim). Impacto: +R$ 0,06/kg</span><br/><br/>
              <b style={{color:C.g}}>Ações recomendadas:</b><br/>
              <span style={{color:C.g}}>✅ Renegociar contratos de compra com fornecedores score {'<'}80 (economia potencial: R$ 380K/mês)</span><br/>
              <span style={{color:C.g}}>✅ Auditoria manutenção Erechim + Concórdia (reduzir paradas = +R$ 520K/mês)</span><br/>
              <span style={{color:C.g}}>✅ Replicar práticas de Lucas do Rio Verde (benchmark) para demais plantas</span><br/>
              <span style={{color:C.g}}>✅ Reajustar preço 2% em clientes sem contrato anual (+R$ 0,35/kg)</span>
            </div>
          </div>
        </Card>
      </>)}

      </div>
      <div style={{textAlign:"center",padding:"12px",fontSize:9,color:C.txd}}>PS Gestão e Capital — Módulo Industrial v1.0 — Dados Simulados para Demonstração</div>
    </div>
  );
}
