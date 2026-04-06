"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";

const GO="#C6973F",GOL="#E8C872",BG="#0F0F0D",BG2="#1C1B18",BG3="#2A2822",
    G="#22C55E",R="#EF4444",Y="#FACC15",B="#3B82F6",P="#A855F7",T="#14B8A6",
    BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#6B6960";

const tt={background:'#FFFFFF',border:'2px solid #C6973F',borderRadius:12,fontSize:12,color:'#1A1A18',padding:'12px 16px',boxShadow:'0 6px 20px rgba(0,0,0,0.4)',lineHeight:1.8};
const tl={color:'#1A1A18',fontWeight:700,fontSize:13,marginBottom:4};const ti={color:'#333',fontSize:11,fontWeight:500};

const fmtBRL=(v:any)=>{
  const n=Number(v);
  if(Math.abs(n)>=1000000) return `R$ ${(n/1000000).toFixed(2)}M`;
  if(Math.abs(n)>=1000) return `R$ ${(n/1000).toFixed(1)}K`;
  return `R$ ${n.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
};
const fmtTooltip=(v:any,name:any)=>[fmtBRL(v),name];
const fmtTooltipPct=(v:any,name:any)=>[`${v}%`,name];
const fmtMesLabel=(k:string)=>{
  if(!k||!k.includes("-")) return k;
  const [a,m]=k.split("-");
  const n=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${n[parseInt(m)-1]}/${a.slice(2)}`;
};

const empresa={nome:"SOLAR OESTE ENERGIA",cidade:"Chapecó/SC",periodo:"Jan-Mar 2025",lns:6,colab:54};

const negocios:any[]=[
  {id:1,nome:"Venda de Equipamentos",tipo:"Comércio",cor:GO,fat:[580,512,672],mc:[107,42,176],mc_p:[19.5,8.7,27.7],lucro_r:[50,-40,148],lucro_p:[9.5,-8.2,23.3],
    hc:6,clientes:361,ticket:"R$ 4.900",inadim:"3,2%",pmr:28,saude:"Forte",bcg:"Estrela",
    produtos:[{n:"Kit Solar 5kWp",v:280,m:28.5,preco:"R$ 18.500"},{n:"Kit Solar 10kWp",v:145,m:26.2,preco:"R$ 32.000"},{n:"Kit Solar 3kWp",v:120,m:32.1,preco:"R$ 12.800"},{n:"Inversor Growatt 5kW",v:95,m:21.4,preco:"R$ 4.200"},{n:"Painel 550W Risen",v:850,m:18.5,preco:"R$ 890"}],
    custos:[{n:"Custo dos Produtos",v:60.2},{n:"Frete/Logística",v:4.8},{n:"Comissões",v:5.5},{n:"Marketing",v:3.2},{n:"Embalagem",v:1.3}],
    obs:"Maior faturamento mas margem comprimida pelo custo dos painéis importados. Março recuperou com projetos maiores."},
  {id:2,nome:"Projetos Residenciais",tipo:"Serviço",cor:B,fat:[242,198,308],mc:[41,34,48],mc_p:[17.9,18.2,16.4],lucro_r:[18,12,23],lucro_p:[7.8,6.4,7.9],
    hc:8,clientes:68,ticket:"R$ 11.000",inadim:"2,1%",pmr:35,saude:"Crescendo",bcg:"Interrogação",
    produtos:[{n:"Proj. Resid. 5kWp",v:32,m:38.2,preco:"R$ 22.500"},{n:"Proj. Resid. 8kWp",v:18,m:35.8,preco:"R$ 33.000"},{n:"Proj. Resid. 3kWp",v:15,m:42.1,preco:"R$ 15.800"},{n:"Ampliação Resid.",v:8,m:45.0,preco:"R$ 8.500"}],
    custos:[{n:"Custo dos Produtos",v:42.5},{n:"Mão de Obra Direta",v:18.0},{n:"Frete",v:5.2},{n:"Terceiros",v:8.5},{n:"Comissões",v:4.5}],
    obs:"Ticket médio subindo. 40% dos clientes são empresários — oportunidade de upsell para Projetos Comerciais."},
  {id:3,nome:"Projetos Comerciais",tipo:"Serviço",cor:G,fat:[425,340,595],mc:[116,93,142],mc_p:[28.9,29.0,25.2],lucro_r:[78,56,94],lucro_p:[19.4,17.4,16.7],
    hc:12,clientes:16,ticket:"R$ 85.000",inadim:"0,8%",pmr:25,saude:"Estrela ★",bcg:"Estrela",
    produtos:[{n:"Proj. Com. 30kWp",v:5,m:45.3,preco:"R$ 78.000"},{n:"Proj. Com. 75kWp",v:3,m:44.0,preco:"R$ 158.000"},{n:"Proj. Ind. 150kWp+",v:2,m:42.9,preco:"R$ 285.000"},{n:"Carport Solar",v:4,m:48.5,preco:"R$ 95.000"},{n:"Retrofit Comercial",v:2,m:52.0,preco:"R$ 45.000"}],
    custos:[{n:"Custo dos Produtos",v:35.0},{n:"Mão de Obra Direta",v:15.0},{n:"Engenharia/Projeto",v:8.0},{n:"Terceiros",v:6.5},{n:"Comissões",v:3.5}],
    obs:"Negócio mais rentável em valor absoluto. Cada projeto gera em média R$ 14K de lucro real. Equipe forte de 12 profissionais."},
  {id:4,nome:"Projetos de Usinas",tipo:"Serviço",cor:P,fat:[890,0,1450],mc:[142,0,232],mc_p:[18.9,0,17.8],lucro_r:[60,-58,214],lucro_p:[7.1,0,15.5],
    hc:10,clientes:3,ticket:"R$ 780.000",inadim:"0%",pmr:45,saude:"Instável",bcg:"Vaca Leiteira",
    produtos:[{n:"Usina 500kWp",v:1,m:38.5,preco:"R$ 650.000"},{n:"Usina 1MWp",v:1,m:35.2,preco:"R$ 1.250.000"},{n:"Usina 300kWp",v:1,m:41.0,preco:"R$ 420.000"}],
    custos:[{n:"Custo dos Produtos",v:45.0},{n:"Mão de Obra",v:12.0},{n:"Engenharia",v:6.5},{n:"Logística Pesada",v:8.0},{n:"Terceiros Especializados",v:10.0}],
    obs:"ALERTA: Fevereiro zerou. 36% do faturamento depende de poucos projetos. Equipe de R$ 68K/mês fica ociosa sem projeto. Pipeline de 12+ propostas é urgente."},
  {id:5,nome:"Manutenção O&M",tipo:"Serviço",cor:T,fat:[51,53,55],mc:[16,16,14],mc_p:[33.1,31.8,27.1],lucro_r:[11,10,10],lucro_p:[22.7,19.8,19.1],
    hc:3,clientes:168,ticket:"R$ 300",inadim:"1,3%",pmr:5,saude:"Joia ★★",bcg:"Joia",
    contratos:{inicio:[148,155,158],fim:[155,158,168],mrr:[46500,47400,50400],churn:[2.0,3.2,1.3],nps:[72,74,76],ltv:7200,cac:350},
    produtos:[{n:"Limpeza Painéis",v:420,m:63.0,preco:"R$ 520"},{n:"O&M Residencial",v:148,m:61.5,preco:"R$ 600/mês"},{n:"O&M Comercial",v:15,m:57.0,preco:"R$ 1.100/mês"},{n:"Visita Técnica",v:35,m:56.0,preco:"R$ 800"},{n:"O&M Usina",v:5,m:50.5,preco:"R$ 2.000/mês"}],
    custos:[{n:"Mão de Obra Técnica",v:35.0},{n:"Deslocamento",v:12.0},{n:"Materiais/Peças",v:8.0},{n:"Seguro RC",v:3.0}],
    obs:"JOIA DO PORTFÓLIO. Único negócio com receita fixa mensal. 168 contratos crescendo. Margem de 20,4%. Meta: triplicar para 500 contratos em 12 meses."},
  {id:6,nome:"Loja Online",tipo:"Comércio",cor:R,fat:[38,41,49],mc:[-3,-5,-4],mc_p:[-8.4,-12.9,-8.6],lucro_r:[-7,-9,-8],lucro_p:[-19.4,-23.1,-17.1],
    hc:2,clientes:365,ticket:"R$ 350",inadim:"5,2%",pmr:30,saude:"Prejuízo",bcg:"Abacaxi",
    produtos:[{n:"Kit Limpeza Solar",v:85,m:35.0,preco:"R$ 189"},{n:"Cabo Solar 6mm",v:120,m:28.0,preco:"R$ 95/10m"},{n:"Conector MC4",v:200,m:42.0,preco:"R$ 25/par"},{n:"String Box",v:30,m:22.0,preco:"R$ 380"}],
    custos:[{n:"Custo dos Produtos",v:55.0},{n:"Frete Grátis",v:15.0},{n:"Plataforma/Taxas",v:12.0},{n:"Marketing Digital",v:18.0},{n:"Embalagem",v:5.0}],
    obs:"DESTRUINDO VALOR. Cada R$ 1 vendido custa R$ 1,09. Frete grátis + marketing digital + taxas = 109,4% do faturamento. Encerrar em 30 dias."},
];

const rev=[{m:"Jan/25",fat:2226,marg:415,estr:179,lucro:236},{m:"Fev/25",fat:1144,marg:104,estr:179,lucro:-74},{m:"Mar/25",fat:3129,marg:687,estr:186,lucro:501}];
const caixa=[{m:"Jan",disp:510,div:700,saldo:-190},{m:"Fev",disp:545,div:665,saldo:-120},{m:"Mar",disp:702,div:630,saldo:72}];

const KPI=({r,v,d,ok}:any)=>(
  <div style={{background:BG2,borderRadius:10,padding:"10px 12px",borderLeft:`3px solid ${ok?GO:ok===false?R:BD}`}}>
    <div style={{fontSize:9,color:TXD,letterSpacing:0.4,textTransform:"uppercase"}}>{r}</div>
    <div style={{fontSize:17,fontWeight:700,color:ok?GOL:ok===false?R:TX,marginTop:3}}>{v}</div>
    <div style={{fontSize:9,color:ok?G:ok===false?R:TXM,marginTop:2}}>{d}</div>
  </div>
);

const Tit=({t}:{t:string})=>(<div style={{display:"flex",alignItems:"center",gap:8,margin:"16px 0 10px"}}><div style={{width:3,height:16,background:GO,borderRadius:2}}/><span style={{fontSize:14,fontWeight:700}}>{t}</span></div>);

const Card=({children,p="14px 16px"}:{children:React.ReactNode,p?:string})=>(<div style={{background:BG2,borderRadius:12,padding:p,marginBottom:10,border:`0.5px solid ${BD}`}}>{children}</div>);

export default function DashboardPage(){
  const [aba,setAba]=useState("geral");
  const [lnAberta,setLnAberta]=useState<number|null>(null);
  const [subAba,setSubAba]=useState("visao");
  const [dreAberto,setDreAberto]=useState<Record<string,boolean>>({});
  const [custoAberto,setCustoAberto]=useState<Record<string,boolean>>({});

  const abas=[{id:"geral",nome:"Painel Geral"},{id:"negocios",nome:"Negócios"},{id:"resultado",nome:"Resultado"},{id:"financeiro",nome:"Financeiro"},{id:"precos",nome:"Preços"},{id:"relatorio",nome:"Relatório"}];
  const abasDemo = ["negocios","precos"];
  const meses=["Jan","Fev","Mar"];

  // If a business line is open, show its detail view
  if(lnAberta!==null){
    const ln=negocios.find(n=>n.id===lnAberta)!;
    const fatData=meses.map((m,i)=>({m,fat:ln.fat[i],mc:ln.mc[i],lucro:ln.lucro_r[i]}));
    const subAbas=[{id:"visao",nome:"Visão Geral"},{id:"produtos",nome:"Produtos"},{id:"custos",nome:"Estrutura de Custos"},
      ...(ln.contratos?[{id:"contratos",nome:"Contratos"}]:[]),{id:"analise",nome:"Análise IA"}];

    return(<div>
      {/* Back button + LN header */}
      <div style={{background:ln.cor+"15",padding:"12px 20px",borderBottom:`2px solid ${ln.cor}`}}>
        <button onClick={()=>{setLnAberta(null);setSubAba("visao");}} style={{background:"none",border:"none",color:GO,fontSize:12,marginBottom:6,cursor:"pointer",padding:0}}>← Voltar para todos os negócios</button>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:6,height:40,borderRadius:3,background:ln.cor}}/>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:TX}}>{ln.nome}</div>
              <div style={{fontSize:11,color:TXM}}>{ln.tipo} | {ln.hc} colaboradores | {ln.clientes} clientes | Ticket médio {ln.ticket}</div>
            </div>
          </div>
          <span style={{fontSize:10,padding:"4px 12px",borderRadius:10,fontWeight:600,background:ln.lucro_r[2]>=0?GO+"20":R+"20",color:ln.lucro_r[2]>=0?GO:R}}>{ln.saude}</span>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:3,padding:"8px 16px",overflowX:"auto",borderBottom:`1px solid ${BD}`}}>
        {subAbas.map(s=>(
          <button key={s.id} onClick={()=>setSubAba(s.id)} style={{padding:"6px 14px",borderRadius:20,fontSize:11,whiteSpace:"nowrap",border:`0.5px solid ${subAba===s.id?ln.cor:BD}`,background:subAba===s.id?ln.cor+"18":"transparent",color:subAba===s.id?TX:TXM,fontWeight:subAba===s.id?600:400}}>{s.nome}</button>
        ))}
      </div>

      <div style={{padding:"14px 20px",maxWidth:1200,margin:"0 auto"}}>

      {/* ---- VISÃO GERAL DO NEGÓCIO ---- */}
      {subAba==="visao"&&(<div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:8,marginBottom:14}}>
          <KPI r="Faturamento 1T" v={`R$ ${(ln.fat[0]+ln.fat[1]+ln.fat[2]).toLocaleString("pt-BR")}K`} d={`${((ln.fat[2]-ln.fat[0])/ln.fat[0]*100).toFixed(0)}% Jan→Mar`} ok={ln.fat[2]>ln.fat[0]}/>
          <KPI r="Margem Direta" v={`${ln.mc_p[2]}%`} d={`Média ${((ln.mc_p[0]+ln.mc_p[1]+ln.mc_p[2])/3).toFixed(1)}%`} ok={ln.mc_p[2]>0}/>
          <KPI r="Lucro Real 1T" v={`R$ ${(ln.lucro_r[0]+ln.lucro_r[1]+ln.lucro_r[2])}K`} d={`${ln.lucro_p[2]}% em março`} ok={ln.lucro_r[2]>0}/>
          <KPI r="Clientes" v={ln.clientes} d={`Ticket ${ln.ticket}`} ok={null}/>
          <KPI r="Inadimplência" v={ln.inadim} d={`PMR ${ln.pmr} dias`} ok={parseFloat(ln.inadim)<3}/>
          <KPI r="Equipe" v={`${ln.hc} pessoas`} d={`Fat/pessoa R$ ${Math.round((ln.fat[0]+ln.fat[1]+ln.fat[2])/ln.hc/3)}K/mês`} ok={null}/>
        </div>

        <Card>
          <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:10}}>Evolução Mensal — Faturamento × Margem × Lucro (R$ mil)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fatData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
              <XAxis dataKey="m" tick={{fontSize:11,fill:'#D4D0C8'}}/>
              <YAxis tick={{fontSize:10,fill:'#D4D0C8'}}/>
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltip}/>
              <Bar dataKey="fat" name="Faturamento" fill={ln.cor} radius={[4,4,0,0]} barSize={18}/>
              <Bar dataKey="mc" name="Margem Direta" fill={G} radius={[4,4,0,0]} barSize={18}/>
              <Bar dataKey="lucro" name="Lucro Real" radius={[4,4,0,0]} barSize={18}>
                {fatData.map((d,i)=><Cell key={i} fill={d.lucro>=0?GOL:R}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:6}}>
            <span style={{fontSize:10,color:ln.cor}}>● Faturamento</span>
            <span style={{fontSize:10,color:G}}>● Margem</span>
            <span style={{fontSize:10,color:GOL}}>● Lucro Real</span>
          </div>
        </Card>

        <Card>
          <div style={{background:BG3,borderRadius:8,padding:12,border:`0.5px solid ${ln.cor}40`}}>
            <div style={{fontSize:10,color:ln.cor,fontWeight:600,marginBottom:4}}>◆ ANÁLISE DO NEGÓCIO</div>
            <div style={{fontSize:11,color:TX,lineHeight:1.7}}>{ln.obs}</div>
          </div>
        </Card>
      </div>)}

      {/* ---- PRODUTOS ---- */}
      {subAba==="produtos"&&(<div>
        <Tit t={`Produtos e Serviços — ${ln.nome}`}/>
        <Card>
          <div style={{fontSize:11,color:TXD,marginBottom:10}}>Ordenados por margem real (incluindo custo da estrutura)</div>
          <ResponsiveContainer width="100%" height={Math.max(150,ln.produtos.length*40)}>
            <BarChart data={[...ln.produtos].sort((a:any,b:any)=>b.m-a.m)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={BD}/>
              <XAxis type="number" tick={{fontSize:10,fill:'#D4D0C8'}} tickFormatter={(v:any)=>`${v}%`}/>
              <YAxis type="category" dataKey="n" tick={{fontSize:9,fill:'#D4D0C8'}} width={120}/>
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltipPct}/>
              <Bar dataKey="m" name="Margem Real %" radius={[0,4,4,0]} barSize={14}>
                {[...ln.produtos].sort((a:any,b:any)=>b.m-a.m).map((p:any,i:number)=><Cell key={i} fill={p.m>50?G:p.m>30?GO:p.m>15?Y:R}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {ln.produtos.map((p:any,i:number)=>(
          <div key={i} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:6,border:`0.5px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:28,height:28,borderRadius:6,background:p.m>50?G+"20":p.m>30?GO+"20":Y+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:p.m>50?G:p.m>30?GO:Y}}>{i+1}</div>
              <div>
                <div style={{fontSize:12,fontWeight:500,color:TX}}>{p.n}</div>
                <div style={{fontSize:9,color:TXD}}>Preço: {p.preco} | {p.v} vendas no trimestre</div>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:18,fontWeight:700,color:p.m>50?G:p.m>30?GO:Y}}>{p.m}%</div>
              <div style={{fontSize:8,color:TXD}}>margem real</div>
            </div>
          </div>
        ))}
      </div>)}

      {/* ---- CUSTOS ---- */}
      {subAba==="custos"&&(<div>
        <Tit t={`Estrutura de Custos — ${ln.nome}`}/>
        <Card>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={ln.custos.map((c:any)=>({name:c.n,value:c.v}))} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}
                label={({name,percent}:any)=>`${name} ${(percent*100).toFixed(0)}%`}>
                {ln.custos.map((_:any,i:number)=><Cell key={i} fill={[R,Y,GO,B,P,T][i%6]} stroke={BG2} strokeWidth={2}/>)}
              </Pie>
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltipPct}/>
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
              <th style={{padding:6,textAlign:"left",color:GOL,fontSize:10}}>Componente do Custo</th>
              <th style={{padding:6,textAlign:"right",color:GOL,fontSize:10}}>% do Faturamento</th>
              <th style={{padding:6,textAlign:"right",color:GOL,fontSize:10}}>R$ Estimado/Mês</th>
            </tr></thead>
            <tbody>
              {ln.custos.map((c:any,i:number)=>{
                const avg=(ln.fat[0]+ln.fat[1]+ln.fat[2])/3;
                return(<tr key={i} style={{borderBottom:`0.5px solid ${BD}40`}}>
                  <td style={{padding:6,color:TX}}>{c.n}</td>
                  <td style={{padding:6,textAlign:"right",color:c.v>30?R:c.v>15?Y:TX,fontWeight:600}}>{c.v}%</td>
                  <td style={{padding:6,textAlign:"right",color:TXM}}>R$ {Math.round(avg*c.v/100*1000).toLocaleString("pt-BR")}</td>
                </tr>);
              })}
              <tr style={{background:GO+"10"}}>
                <td style={{padding:6,fontWeight:700,color:TX}}>TOTAL CUSTOS DIRETOS</td>
                <td style={{padding:6,textAlign:"right",fontWeight:700,color:GOL}}>{ln.custos.reduce((a:number,c:any)=>a+c.v,0).toFixed(1)}%</td>
                <td style={{padding:6,textAlign:"right",fontWeight:700,color:GOL}}>R$ {Math.round((ln.fat[0]+ln.fat[1]+ln.fat[2])/3*ln.custos.reduce((a:number,c:any)=>a+c.v,0)/100*1000).toLocaleString("pt-BR")}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>)}

      {/* ---- CONTRATOS (só Manutenção) ---- */}
      {subAba==="contratos"&&ln.contratos&&(<div>
        <Tit t="Base de Contratos — Receita Recorrente"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:8,marginBottom:14}}>
          <KPI r="Contratos Ativos" v={ln.contratos.fim[2]} d={`+${ln.contratos.fim[2]-ln.contratos.inicio[0]} no trimestre`} ok={true}/>
          <KPI r="Receita Mensal Fixa" v={`R$ ${(ln.contratos.mrr[2]/1000).toFixed(1)}K`} d={`▲ ${((ln.contratos.mrr[2]-ln.contratos.mrr[0])/ln.contratos.mrr[0]*100).toFixed(0)}% no tri`} ok={true}/>
          <KPI r="Cancelamento" v={`${ln.contratos.churn[2]}%`} d={`Era ${ln.contratos.churn[0]}% em Jan`} ok={ln.contratos.churn[2]<ln.contratos.churn[0]}/>
          <KPI r="Satisfação (NPS)" v={ln.contratos.nps[2]} d={`▲ Subindo`} ok={ln.contratos.nps[2]>70}/>
          <KPI r="Valor Vitalício (LTV)" v={`R$ ${ln.contratos.ltv.toLocaleString("pt-BR")}`} d={`18 meses × ticket`} ok={true}/>
          <KPI r="Retorno s/ Aquisição" v={`${(ln.contratos.ltv/ln.contratos.cac).toFixed(1)}x`} d={`CAC R$ ${ln.contratos.cac}`} ok={ln.contratos.ltv/ln.contratos.cac>10}/>
        </div>

        <Card>
          <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:10}}>Evolução da Base de Contratos</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={meses.map((m,i)=>({m,inicio:ln.contratos.inicio[i],fim:ln.contratos.fim[i]}))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
              <XAxis dataKey="m" tick={{fontSize:11,fill:'#D4D0C8'}}/>
              <YAxis tick={{fontSize:10,fill:'#D4D0C8'}}/>
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti}/>
              <Bar dataKey="inicio" name="Início do mês" fill={B} opacity={0.5} radius={[4,4,0,0]} barSize={16}/>
              <Bar dataKey="fim" name="Fim do mês" fill={GO} radius={[4,4,0,0]} barSize={16}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div style={{background:BG3,borderRadius:8,padding:12,border:`0.5px solid ${G}40`}}>
            <div style={{fontSize:10,color:G,fontWeight:600,marginBottom:4}}>◆ POR QUE ESTE É O NEGÓCIO MAIS VALIOSO</div>
            <div style={{fontSize:11,color:TX,lineHeight:1.7}}>Cada contrato custa R$ 350 para conquistar e gera R$ 7.200 ao longo de 18 meses — retorno de 20,6 vezes. A carteira de 168 contratos, pelo método de múltiplos (2-4x receita anual), vale entre R$ 1,2M e R$ 2,4M. Triplicar para 500 contratos em 12 meses é viável contratando +2 técnicos e +1 vendedor dedicado. Meta de receita fixa: R$ 150K/mês.</div>
          </div>
        </Card>
      </div>)}

      {/* ---- ANÁLISE IA ---- */}
      {subAba==="analise"&&(<div>
        <Tit t={`Análise Inteligente — ${ln.nome}`}/>
        <Card>
          <div style={{fontSize:13,color:TX,lineHeight:1.8}}>
            <p style={{marginBottom:12}}><strong style={{color:GOL}}>Diagnóstico:</strong> {ln.obs}</p>
            <p style={{marginBottom:12}}><strong style={{color:GOL}}>Margem real após rateio:</strong> A margem direta de {ln.mc_p[2]}% cai para {ln.lucro_p[2]}% quando incluímos a parcela do custo da estrutura central que este negócio consome (aluguel, salários administrativos, contabilidade, veículos). {ln.lucro_r[2]>=0?`Ainda assim, gera R$ ${ln.lucro_r[2]}K de lucro real em março.`:`Resultado negativo de R$ ${Math.abs(ln.lucro_r[2])}K em março. Ação urgente necessária.`}</p>
            <p style={{marginBottom:12}}><strong style={{color:GOL}}>Produtividade:</strong> Com {ln.hc} colaboradores e faturamento médio de R$ {Math.round((ln.fat[0]+ln.fat[1]+ln.fat[2])/3)}K/mês, cada pessoa gera R$ {Math.round((ln.fat[0]+ln.fat[1]+ln.fat[2])/3/ln.hc)}K/mês de receita. {(ln.fat[0]+ln.fat[1]+ln.fat[2])/3/ln.hc>40?"Acima da média do setor.":"Abaixo do ideal — avaliar produtividade individual."}</p>
            <p><strong style={{color:GOL}}>Produto mais rentável:</strong> {ln.produtos[0].n} com {ln.produtos[0].m}% de margem real. {ln.produtos[0].m>50?"Excelente — expandir volume.":"Margem aceitável — avaliar possibilidade de aumento de preço."}</p>
          </div>
        </Card>
      </div>)}

      </div>
    </div>);
  }

  // ===== MAIN DASHBOARD =====
  const [empresaSel, setEmpresaSel] = useState("consolidado");
  const [periodoInicio, setPeriodoInicio] = useState(()=>{
    const d=new Date(); d.setMonth(d.getMonth()-5);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const [periodoFim, setPeriodoFim] = useState(()=>{
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const [dbCompanies, setDbCompanies] = useState<any[]>([]);
  const [loadingDb, setLoadingDb] = useState(true);
  const [omieData, setOmieData] = useState<any[]>([]);
  const [realData, setRealData] = useState<any>(null);
  const [loadingReal, setLoadingReal] = useState(false);

  useEffect(() => {
    supabase.from("companies").select("*").order("created_at").then(({data}) => {
      if(data && data.length > 0) setDbCompanies(data);
      setLoadingDb(false);
    });
    supabase.from("omie_imports").select("company_id,import_type,record_count,imported_at").then(({data}) => {
      if(data) setOmieData(data);
    });
  }, []);

  // Load processed data from SERVER API (cache-busted)
  useEffect(() => {
    if(dbCompanies.length === 0 || omieData.length === 0) return;
    setLoadingReal(true);
    const compIds = empresaSel==="consolidado" ? dbCompanies.map(c=>c.id) : [empresaSel];
    fetch(`/api/omie/process?t=${Date.now()}`, {
      method: "POST",
      headers: {"Content-Type":"application/json","Cache-Control":"no-cache"},
      body: JSON.stringify({ company_ids: compIds, periodo_inicio: periodoInicio, periodo_fim: periodoFim })
    }).then(r=>r.json()).then(d=>{
      if(d.success) setRealData(d.data);
      setLoadingReal(false);
    }).catch(()=>setLoadingReal(false));
  }, [empresaSel, dbCompanies, omieData, periodoInicio, periodoFim]);

  const grupoEmpresas = [
    {id:"consolidado",nome:dbCompanies.length>1?"Grupo Consolidado":"Empresa",cnpj:"Todos",pais:"—"},
    ...dbCompanies.map(c=>({id:c.id,nome:c.nome_fantasia||c.razao_social,cnpj:c.cnpj||"",pais:c.pais||"Brasil"}))
  ];

  const empresaAtiva = empresaSel==="consolidado" 
    ? {nome:dbCompanies.length>0?(dbCompanies[0].nome_fantasia||dbCompanies[0].razao_social):empresa.nome,cidade:dbCompanies.length>0?(dbCompanies[0].cidade_estado||empresa.cidade):empresa.cidade,lns:empresa.lns,colab:dbCompanies.length>0?(dbCompanies[0].num_colaboradores||empresa.colab):empresa.colab}
    : {nome:dbCompanies.find(c=>c.id===empresaSel)?.nome_fantasia||dbCompanies.find(c=>c.id===empresaSel)?.razao_social||empresa.nome,cidade:dbCompanies.find(c=>c.id===empresaSel)?.cidade_estado||empresa.cidade,lns:empresa.lns,colab:dbCompanies.find(c=>c.id===empresaSel)?.num_colaboradores||empresa.colab};

  // Build chart data from raw monthly data (computed in render to avoid stale state)
  const chartData = (()=>{
    if(!realData?.raw_rec && !realData?.raw_desp) return [];
    const rec = realData.raw_rec || {};
    const desp = realData.raw_desp || {};
    const allM = [...new Set([...Object.keys(rec),...Object.keys(desp)])].sort().slice(-12);
    return allM.map(m=>{
      const label = fmtMesLabel(m);
      return {
        mes: m, mesLabel: label,
        receitas: rec[m]||0,
        despesas: desp[m]||0,
        resultado: (rec[m]||0)-(desp[m]||0),
      };
    });
  })();

  return(<div>
    <div style={{padding:"12px 20px",background:BG2,borderBottom:`1px solid ${BD}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:14,color:GOL,fontWeight:600}}>{empresaSel==="consolidado"&&dbCompanies.length>1?"GRUPO: ":""}{empresaAtiva.nome}</div>
          <div style={{fontSize:10,color:TXD}}>{empresaAtiva.cidade}{empresaAtiva.colab?` | ${empresaAtiva.colab} colaboradores`:""}{dbCompanies.length>1?` | ${dbCompanies.length} empresas no grupo`:""}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {grupoEmpresas.length>1&&(
            <select value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:600}}>
              {grupoEmpresas.map(e=><option key={e.id} value={e.id}>{e.nome}{e.pais!=="—"?` (${e.pais})`:""}</option>)}
            </select>
          )}
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <input type="month" value={periodoInicio} onChange={e=>setPeriodoInicio(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:600}}/>
            <span style={{fontSize:10,color:TXD}}>a</span>
            <input type="month" value={periodoFim} onChange={e=>setPeriodoFim(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:600}}/>
          </div>
        </div>
      </div>
    </div>

    <div style={{display:"flex",gap:3,padding:"8px 12px",overflowX:"auto",borderBottom:`1px solid ${BD}`}}>
      {abas.map(a=>(<button key={a.id} onClick={()=>setAba(a.id)} style={{padding:"7px 14px",borderRadius:20,fontSize:11,whiteSpace:"nowrap",border:`0.5px solid ${aba===a.id?GO:BD}`,background:aba===a.id?GO+"18":"transparent",color:aba===a.id?GOL:TXM,fontWeight:aba===a.id?600:400,position:"relative"}}>{a.nome}{realData&&abasDemo.includes(a.id)&&<span style={{fontSize:7,color:Y,marginLeft:3,verticalAlign:"super"}}>demo</span>}</button>))}
    </div>

    <div style={{padding:"14px 20px",maxWidth:1200,margin:"0 auto"}}>

    {aba==="geral"&&(<div>
      {/* Data Quality Alerts */}
      {realData&&(()=>{
        const alerts: {sev:string,msg:string,det:string}[] = [];
        if(realData.resultado_periodo<0) alerts.push({sev:"critico",msg:`Resultado negativo: R$ ${(realData.resultado_periodo/1000).toFixed(0)}K`,det:"A empresa está gastando mais do que fatura. Ação imediata necessária."});
        if(realData.top_receitas?.some((r:any)=>r.nome?.toLowerCase().includes("empréstimo")||r.nome?.toLowerCase().includes("financiamento")||r.nome?.toLowerCase().includes("aporte")))
          alerts.push({sev:"atencao",msg:"Empréstimos/financiamentos estão sendo contados como receita",det:"Isso infla o faturamento real. Reclassifique no Omie: Categorias → mova empréstimos para 4.xx ou 5.xx"});
        return alerts.length>0?(
          <div style={{marginBottom:12}}>
            {alerts.map((a,i)=>(
              <div key={i} style={{background:a.sev==="critico"?"#EF444415":"#FACC1512",borderRadius:8,padding:"10px 14px",marginBottom:6,borderLeft:`4px solid ${a.sev==="critico"?"#EF4444":"#FACC15"}`}}>
                <div style={{fontSize:12,fontWeight:600,color:a.sev==="critico"?"#EF4444":"#FACC15"}}>{a.sev==="critico"?"⚠":"⚡"} {a.msg}</div>
                <div style={{fontSize:10,color:"#A8A498",marginTop:3}}>{a.det}</div>
              </div>
            ))}
          </div>
        ):null;
      })()}

      {/* Real data from Omie */}
      {realData&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
            <KPI r="Receitas (Contas a Receber)" v={`R$ ${(realData.total_receitas/1000).toFixed(0)}K`} d={`${realData.num_empresas} empresas consolidadas`} ok={true}/>
            <KPI r="Despesas (Contas a Pagar)" v={`R$ ${(realData.total_despesas/1000).toFixed(0)}K`} d={`Total do período`} ok={null}/>
            <KPI r="Resultado do Período" v={`R$ ${(realData.resultado_periodo/1000).toFixed(0)}K`} d={`Margem ${realData.margem}%`} ok={realData.resultado_periodo>0}/>
            <KPI r="Clientes" v={realData.total_clientes.toLocaleString("pt-BR")} d="Cadastrados no Omie" ok={true}/>
          </div>

          {(realData.chart_mensal||chartData)&&(realData.chart_mensal||chartData).length>0&&(
            <Card>
              <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:10}}>Receitas × Despesas — Dados Reais do Omie (R$)</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={realData.chart_mensal||chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
                  <XAxis dataKey="mesLabel" tick={{fontSize:10,fill:'#D4D0C8'}}/>
                  <YAxis tick={{fontSize:9,fill:'#D4D0C8'}} tickFormatter={(v:any)=>`${(v/1000).toFixed(0)}K`}/>
                  <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltip}/>
                  <Bar dataKey="receitas" name="Receitas" fill={G} radius={[4,4,0,0]} barSize={16}/>
                  <Bar dataKey="despesas" name="Despesas" fill={R} opacity={0.7} radius={[4,4,0,0]} barSize={16}/>
                </BarChart>
              </ResponsiveContainer>
              <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:6}}>
                <span style={{fontSize:10,color:G}}>● Receitas</span>
                <span style={{fontSize:10,color:R}}>● Despesas</span>
              </div>
            </Card>
          )}

          {realData.top_custos&&realData.top_custos.length>0&&(
            <Card>
              <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:10}}>Maiores Custos — Dados Reais do Omie (Top 10)</div>
              {realData.top_custos.slice(0,10).map((c:any,i:number)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`0.5px solid ${BD}20`}}>
                  <div style={{width:24,height:24,borderRadius:6,background:i<3?R+"20":i<6?Y+"20":GO+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:i<3?R:i<6?Y:GO}}>{i+1}</div>
                  <div style={{flex:1,fontSize:11,color:TX}}>{c.nome}</div>
                  <div style={{fontSize:13,fontWeight:700,color:i<3?R:i<6?Y:TX}}>R$ {(c.valor/1000).toFixed(1)}K</div>
                </div>
              ))}
            </Card>
          )}

          <div style={{fontSize:9,color:TXD,textAlign:"right",marginBottom:10}}>Fonte: Omie API | Última sincronização: {omieData.length>0?new Date(Math.max(...omieData.map(d=>new Date(d.imported_at).getTime()))).toLocaleString("pt-BR"):""}</div>
        </div>
      )}

      {loadingReal&&!realData&&(
        <Card><div style={{textAlign:"center",padding:20,color:TXM,fontSize:12}}>Processando dados do Omie...</div></Card>
      )}

      {!realData&&!loadingReal&&omieData.length===0&&(<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
        <KPI r="Faturamento 1T" v="R$ 6,5M" d="▲ 9% acima da meta" ok={true}/>
        <KPI r="Lucro da Operação" v="R$ 663K" d="10,2% do faturamento" ok={true}/>
        <KPI r="Lucro Final" v="R$ 602K" d="Após impostos e juros" ok={true}/>
        <KPI r="Dinheiro Disponível" v="R$ 702K" d="113 dias de cobertura" ok={true}/>
        <KPI r="Caixa - Dívidas" v="Sobram R$ 72K" d="✓ Caixa > Dívida" ok={true}/>
        <KPI r="Colaboradores" v="54 pessoas" d="38 oper. + 8 adm." ok={null}/>
        <KPI r="Loja Online" v="(R$ 24K)" d="⚠ Prejuízo no trimestre" ok={false}/>
        <KPI r="Contratos O&M" v="168 ativos" d="R$ 50,4K/mês recorrente" ok={true}/>
      </div>

      <Card>
        <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:10}}>Faturamento × Lucro — Mês a Mês (R$ mil)</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={rev}>
            <defs><linearGradient id="gF" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={GO} stopOpacity={0.3}/><stop offset="95%" stopColor={GO} stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
            <XAxis dataKey="m" tick={{fontSize:11,fill:'#D4D0C8'}}/>
            <YAxis tick={{fontSize:10,fill:'#D4D0C8'}}/>
            <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltip}/>
            <Area type="monotone" dataKey="fat" stroke={GO} fill="url(#gF)" strokeWidth={2} name="Faturamento"/>
            <Line type="monotone" dataKey="lucro" stroke={G} strokeWidth={2.5} dot={{r:5,fill:G}} name="Lucro"/>
            <Line type="monotone" dataKey="estr" stroke={R} strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Custo Estrutura"/>
          </AreaChart>
        </ResponsiveContainer>
      </Card>
      </>)}

      {!realData&&(<>
      <Tit t="Seus 6 Negócios — Clique para ver os detalhes"/>
      {negocios.map(n=>(
        <div key={n.id} onClick={()=>{setLnAberta(n.id);setSubAba("visao");}} style={{background:BG2,borderRadius:10,padding:"12px 14px",marginBottom:8,borderLeft:`4px solid ${n.cor}`,border:`0.5px solid ${BD}`,cursor:"pointer",transition:"all 0.2s"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div><div style={{fontSize:13,fontWeight:600,color:TX}}>{n.nome}</div><div style={{fontSize:9,color:TXD}}>{n.tipo} | {n.hc} pessoas | {n.clientes} clientes</div></div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:600,background:n.lucro_r[2]>=0?GO+"20":R+"20",color:n.lucro_r[2]>=0?GO:R}}>{n.saude}</span>
              <span style={{color:GO,fontSize:16}}>›</span>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
            {[["Faturou",`R$${(n.fat[0]+n.fat[1]+n.fat[2])}K`,TX],["Margem",`${n.mc_p[2]}%`,n.mc[2]>=0?G:R],["Lucro Real",`R$${(n.lucro_r[0]+n.lucro_r[1]+n.lucro_r[2])}K`,n.lucro_r[2]>=0?GO:R],["Lucro %",`${n.lucro_p[2]}%`,n.lucro_r[2]>=0?GO:R]].map(([lb,vl,cl])=>(
              <div key={lb as string} style={{textAlign:"center",background:BG3,borderRadius:6,padding:"5px 4px"}}>
                <div style={{fontSize:8,color:TXD}}>{lb}</div><div style={{fontSize:12,fontWeight:700,color:cl as string}}>{vl}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      </>)}

      {realData&&realData.top_receitas_operacionais&&(<>
        <Tit t={`Linhas de Receita — ${realData.top_receitas_operacionais.length} categorias identificadas`}/>
        {realData.top_receitas_operacionais.slice(0,8).map((r:any,i:number)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"12px 14px",marginBottom:6,borderLeft:`4px solid ${[GO,G,B,P,T,GOL,R,Y][i%8]}`,border:`0.5px solid ${BD}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:TX}}>{r.nome}</div>
                <div style={{fontSize:9,color:TXD}}>Categoria Omie | Receita operacional</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:16,fontWeight:700,color:G}}>R$ {(r.valor/1000).toFixed(0)}K</div>
                <div style={{fontSize:9,color:TXD}}>{realData.total_rec_operacional>0?((r.valor/realData.total_rec_operacional)*100).toFixed(1):"0"}% do total</div>
              </div>
            </div>
          </div>
        ))}
      </>)}
    </div>)}

    {aba==="financeiro"&&(<div>
      {realData&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
          <KPI r="Receita Operacional" v={`R$ ${((realData.total_rec_operacional||realData.total_receitas)/1000).toFixed(0)}K`} d="Faturamento real (sem empréstimos)" ok={true}/>
          <KPI r="Despesas Totais" v={`R$ ${(realData.total_despesas/1000).toFixed(0)}K`} d="Contas a pagar do período" ok={null}/>
          <KPI r="Resultado Operacional" v={`R$ ${(realData.resultado_periodo/1000).toFixed(0)}K`} d={`Margem ${realData.margem}%`} ok={realData.resultado_periodo>0}/>
          <KPI r="Empréstimos Recebidos" v={`R$ ${((realData.total_emprestimos||0)/1000).toFixed(0)}K`} d="Financiamentos, aportes, transferências" ok={null}/>
          <KPI r="Clientes" v={realData.total_clientes.toLocaleString("pt-BR")} d="No cadastro do Omie" ok={true}/>
          <KPI r="Empresas no Grupo" v={`${realData.num_empresas}`} d="CNPJs consolidados" ok={null}/>
        </div>
        <Tit t="Receitas × Despesas × Resultado — Mês a Mês"/>
        <Card>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={realData.chart_mensal||chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
              <XAxis dataKey="mesLabel" tick={{fontSize:10,fill:'#D4D0C8'}}/>
              <YAxis tick={{fontSize:9,fill:'#D4D0C8'}} tickFormatter={(v:any)=>`${(v/1000).toFixed(0)}K`}/>
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltip}/>
              <Bar dataKey="receitas" name="Receitas" fill={G} radius={[4,4,0,0]} barSize={14}/>
              <Bar dataKey="despesas" name="Despesas" fill={R} opacity={0.6} radius={[4,4,0,0]} barSize={14}/>
              <Line type="monotone" dataKey="resultado" name="Resultado" stroke={GOL} strokeWidth={2.5} dot={{r:4,fill:GOL}}/>
            </BarChart>
          </ResponsiveContainer>
          <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:6}}>
            <span style={{fontSize:10,color:G}}>● Receitas</span>
            <span style={{fontSize:10,color:R}}>● Despesas</span>
            <span style={{fontSize:10,color:GOL}}>— Resultado</span>
          </div>
        </Card>

        {realData.top_receitas_operacionais&&realData.top_receitas_operacionais.length>0&&(<>
          <Tit t="Receitas Operacionais (Faturamento Real)"/>
          <Card>
            {realData.top_receitas_operacionais.map((r:any,i:number)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`0.5px solid ${BD}20`}}>
                <div style={{width:24,height:24,borderRadius:6,background:G+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:G}}>{i+1}</div>
                <div style={{flex:1,fontSize:11,color:TX}}>{r.nome}</div>
                <div style={{fontSize:13,fontWeight:700,color:G}}>R$ {(r.valor/1000).toFixed(1)}K</div>
              </div>
            ))}
          </Card>
        </>)}

        {realData.top_emprestimos&&realData.top_emprestimos.length>0&&(<>
          <Tit t="Empréstimos e Financiamentos (Não é faturamento)"/>
          <Card>
            {realData.top_emprestimos.map((r:any,i:number)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`0.5px solid ${BD}20`}}>
                <div style={{width:24,height:24,borderRadius:6,background:Y+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:Y}}>{i+1}</div>
                <div style={{flex:1,fontSize:11,color:TXM}}>{r.nome}</div>
                <div style={{fontSize:13,fontWeight:700,color:Y}}>R$ {(r.valor/1000).toFixed(1)}K</div>
              </div>
            ))}
            <div style={{fontSize:9,color:Y,marginTop:8,padding:"6px 8px",background:Y+"10",borderRadius:4}}>⚡ Estes valores NÃO são contabilizados como receita operacional nos KPIs acima</div>
          </Card>
        </>)}

        <div style={{fontSize:9,color:TXD,textAlign:"right",margin:"8px 0"}}>Fonte: Omie API — dados reais</div>
      </>)}

      {!realData&&(<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
        <KPI r="Capacidade Pagar Contas" v="2,73x" d="Excelente (>1,5)" ok={true}/>
        <KPI r="Dívida vs Patrimônio" v="37,1%" d="Controlado (<50%)" ok={true}/>
        <KPI r="Dias que o Caixa Aguenta" v="113 dias" d="▲ Crescendo" ok={true}/>
        <KPI r="Gasto Diário" v="R$ 6.032/dia" d="Estrutura ÷ 30" ok={null}/>
        <KPI r="Parcelas Mensais" v="R$ 43.700" d="Empréstimos + juros" ok={null}/>
        <KPI r="Faturamento/Pessoa" v="R$ 40.500" d="Média mensal" ok={null}/>
      </div>
      <Tit t="Dinheiro em Caixa vs Dívidas"/>
      <Card>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={caixa}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
            <XAxis dataKey="m" tick={{fontSize:11,fill:'#D4D0C8'}}/>
            <YAxis tick={{fontSize:10,fill:'#D4D0C8'}} tickFormatter={(v:any)=>`R$${v}`} domain={[-200,750]}/>
            <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltip}/>
            <Line type="monotone" dataKey="disp" stroke={G} strokeWidth={2.5} dot={{r:5,fill:G}} name="Disponível"/>
            <Line type="monotone" dataKey="div" stroke={R} strokeWidth={2} dot={{r:4,fill:R}} name="Dívidas"/>
            <Line type="monotone" dataKey="saldo" stroke={GOL} strokeWidth={2.5} strokeDasharray="5 5" dot={{r:5,fill:GOL}} name="Saldo"/>
          </LineChart>
        </ResponsiveContainer>
        <div style={{background:G+"15",borderRadius:8,padding:10,marginTop:8,textAlign:"center",border:`0.5px solid ${G}40`}}>
          <div style={{fontSize:11,fontWeight:600,color:G}}>✓ Março: caixa superou dívidas pela primeira vez</div>
        </div>
      </Card>
      </>)}
    </div>)}

    {aba==="negocios"&&(<div>
      <Tit t="Clique em qualquer negócio para explorar em detalhe"/>
      {negocios.map(n=>(
        <div key={n.id} onClick={()=>{setLnAberta(n.id);setSubAba("visao");}} style={{background:BG2,borderRadius:10,padding:"14px",marginBottom:8,borderLeft:`4px solid ${n.cor}`,border:`0.5px solid ${BD}`,cursor:"pointer"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:14,fontWeight:600,color:TX}}>{n.nome}</div><div style={{fontSize:10,color:TXD}}>{n.tipo} | {n.produtos.length} produtos | {n.hc} pessoas</div></div>
            <span style={{color:GO,fontSize:20}}>›</span>
          </div>
        </div>
      ))}
    </div>)}

    {aba==="resultado"&&(<div>
      {/* REAL DATA FROM OMIE */}
      {realData&&realData.dre_mensal&&realData.dre_mensal.length>0&&(<>
        <Tit t="Resultado Financeiro — Dados Reais do Omie"/>
        <Card p="8px">
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:500}}>
              <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                {["",
                  ...realData.dre_mensal.slice(-6).map((d:any)=>d.mesLabel||d.mes),
                  "Total"
                ].map((h:string)=><th key={h} style={{padding:"8px 6px",textAlign:h===""?"left":"right",color:GOL,fontSize:10}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[
                  {c:"RECEITA BRUTA",key:"receita",d:true,tp:"fat"},
                  {c:"(-) Deduções e Impostos",key:"deducoes",d:false,tp:"x"},
                  {c:"(-) Custos Diretos",key:"custos_diretos",d:false,tp:"x"},
                  {c:"= MARGEM BRUTA",key:"margem",d:true,tp:"mg"},
                  {c:"(-) Despesas Administrativas",key:"despesas_adm",d:false,tp:"x"},
                  {c:"= LUCRO OPERACIONAL",key:"lucro_op",d:true,tp:"lc"},
                  {c:"(-) Resultado Financeiro",key:"financeiro",d:false,tp:"x"},
                  {c:"(-) Outros",key:"outros",d:false,tp:"x"},
                  {c:"= LUCRO FINAL",key:"lucro_final",d:true,tp:"fl"},
                ].map((row:any,i:number)=>{
                  const vals = realData.dre_mensal.slice(-6).map((d:any)=>d[row.key]||0);
                  const total = vals.reduce((a:number,v:number)=>a+v,0);
                  return(<tr key={i} style={{background:row.tp==="mg"?G+"10":row.tp==="lc"?GO+"10":row.tp==="fl"?GO+"18":"transparent",borderBottom:`0.5px solid ${BD}40`}}>
                    <td style={{padding:6,fontWeight:row.d?700:400,color:row.d?TX:TXM,minWidth:160}}>{row.c}</td>
                    {vals.map((v:number,k:number)=><td key={k} style={{padding:6,textAlign:"right",fontWeight:row.d?700:400,color:v<0?R:["mg","lc","fl"].includes(row.tp)?GOL:TX,fontSize:10}}>
                      {v<0?`(${Math.abs(v/1000).toFixed(0)}K)`:`${(v/1000).toFixed(0)}K`}
                    </td>)}
                    <td style={{padding:6,textAlign:"right",fontWeight:700,color:total<0?R:["mg","lc","fl"].includes(row.tp)?GOL:TX}}>
                      {total<0?`(${Math.abs(total/1000).toFixed(0)}K)`:`${(total/1000).toFixed(0)}K`}
                    </td>
                  </tr>);
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Real cost map */}
        {realData.grupos_custo&&realData.grupos_custo.length>0&&(<>
          <Tit t="Mapa de Custos — Dados Reais do Omie (do maior para o menor)"/>
          {realData.grupos_custo.map((g:any,gi:number)=>(
            <Card key={gi}>
              <div onClick={()=>setCustoAberto({...custoAberto,["rg"+gi]:!custoAberto["rg"+gi]})} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:10,color:GO}}>{custoAberto["rg"+gi]?"▼":"▶"}</span>
                  <span style={{fontSize:13,fontWeight:600,color:TX}}>{g.nome}</span>
                  <span style={{fontSize:10,color:TXD}}>({g.contas.length} contas)</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <span style={{fontSize:15,fontWeight:700,color:gi<2?R:gi<4?Y:TX}}>R$ {(g.total/1000).toFixed(1)}K</span>
                  <span style={{fontSize:10,color:TXD}}>{realData.total_despesas>0?((g.total/realData.total_despesas)*100).toFixed(1):"0"}%</span>
                </div>
              </div>
              {custoAberto["rg"+gi]&&(
                <div style={{marginTop:8}}>
                  {g.contas.slice(0,15).map((c:any,ci:number)=>(
                    <div key={ci} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 4px 20px",borderBottom:`0.5px solid ${BD}20`}}>
                      <span style={{fontSize:10,color:TXM}}>{c.nome}</span>
                      <span style={{fontSize:11,fontWeight:600,color:TX}}>R$ {(c.valor/1000).toFixed(1)}K</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}

          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:700,color:TX}}>TOTAL DE CUSTOS E DESPESAS</span>
              <span style={{fontSize:18,fontWeight:700,color:R}}>R$ {(realData.total_despesas/1000).toFixed(0)}K</span>
            </div>
          </Card>
        </>)}

        <div style={{fontSize:9,color:TXD,textAlign:"right",margin:"8px 0"}}>Fonte: Omie API — dados reais processados</div>
      </>)}

      {/* DEMO DATA - only show when no real data */}
      {(!realData||!realData.dre_mensal||realData.dre_mensal.length===0)&&(<>
      <Tit t="Resultado Financeiro — Clique nas linhas para abrir os detalhes"/>
      <Card p="8px">
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:500}}>
            <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
              {["","Jan","Fev","Mar","Total 1T"].map(h=><th key={h} style={{padding:"8px 6px",textAlign:h===""?"left":"right",color:GOL,fontSize:10}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {[
                {id:"fat",c:"FATURAMENTO BRUTO",j:"2.226.400",f:"1.144.200",m:"3.129.400",t:"6.500.000",d:true,tp:"fat",
                  subs:[
                    {c:"Venda de Equipamentos",j:"580.000",f:"512.000",m:"672.000",t:"1.764.000"},
                    {c:"Projetos Residenciais",j:"242.000",f:"198.000",m:"308.000",t:"748.000"},
                    {c:"Projetos Comerciais",j:"425.000",f:"340.000",m:"595.000",t:"1.360.000"},
                    {c:"Projetos de Usinas",j:"890.000",f:"0",m:"1.450.000",t:"2.340.000"},
                    {c:"Manutenção O&M",j:"51.000",f:"53.000",m:"55.000",t:"159.000"},
                    {c:"Loja Online",j:"38.400",f:"41.200",m:"49.400",t:"129.000"},
                  ]},
                {id:"ded",c:"(-) Devoluções + Impostos sobre Vendas",j:"(122.040)",f:"(68.940)",m:"(172.375)",t:"(363.355)",d:false,tp:"x",
                  subs:[
                    {c:"Devoluções e abatimentos",j:"(10.620)",f:"(9.750)",m:"(14.565)",t:"(34.935)"},
                    {c:"ISS / ICMS",j:"(55.660)",f:"(28.605)",m:"(78.235)",t:"(162.500)"},
                    {c:"PIS",j:"(14.570)",f:"(7.480)",m:"(20.445)",t:"(42.495)"},
                    {c:"COFINS",j:"(41.190)",f:"(23.105)",m:"(59.130)",t:"(123.425)"},
                  ]},
                {id:"liq",c:"= FATURAMENTO LÍQUIDO",j:"2.104.360",f:"1.075.260",m:"2.957.025",t:"6.136.645",d:true,tp:"sub"},
                {id:"cdir",c:"(-) Custos Diretos dos 6 Negócios",j:"(1.689.690)",f:"(970.884)",m:"(2.270.411)",t:"(4.930.985)",d:false,tp:"x",
                  subs:[
                    {c:"Custo dos produtos e insumos (CMV)",j:"(1.090.490)",f:"(519.160)",m:"(1.529.120)",t:"(3.138.770)"},
                    {c:"Mão de obra direta (6 equipes)",j:"(228.000)",f:"(228.000)",m:"(228.000)",t:"(684.000)"},
                    {c:"Terceirização",j:"(85.000)",f:"(52.000)",m:"(115.000)",t:"(252.000)"},
                    {c:"Frete e logística",j:"(98.200)",f:"(62.724)",m:"(135.291)",t:"(296.215)"},
                    {c:"Marketing direto dos negócios",j:"(68.000)",f:"(42.000)",m:"(95.000)",t:"(205.000)"},
                    {c:"Comissões de vendas",j:"(120.000)",f:"(67.000)",m:"(168.000)",t:"(355.000)"},
                  ]},
                {id:"mg",c:"= MARGEM DIRETA (o que sobra dos negócios)",j:"414.670",f:"104.376",m:"686.614",t:"1.205.660",d:true,tp:"mg"},
                {id:"estr",c:"(-) Custo da Estrutura Central",j:"(178.485)",f:"(178.650)",m:"(185.720)",t:"(542.855)",d:false,tp:"x",
                  subs:[
                    {c:"Salários dos sócios (pró-labore)",j:"(18.000)",f:"(18.000)",m:"(18.000)",t:"(54.000)"},
                    {c:"Equipe administrativa (8 pessoas)",j:"(28.500)",f:"(29.200)",m:"(29.800)",t:"(87.500)"},
                    {c:"Encargos e benefícios",j:"(17.800)",f:"(18.200)",m:"(18.500)",t:"(54.500)"},
                    {c:"Aluguel da sede",j:"(8.500)",f:"(8.500)",m:"(8.500)",t:"(25.500)"},
                    {c:"Energia, água, internet, telefone",j:"(4.700)",f:"(4.800)",m:"(4.700)",t:"(14.200)"},
                    {c:"Contabilidade e assessorias",j:"(13.200)",f:"(13.500)",m:"(13.800)",t:"(40.500)"},
                    {c:"Combustível e manutenção veículos",j:"(13.800)",f:"(14.100)",m:"(14.200)",t:"(42.100)"},
                    {c:"Marketing institucional",j:"(7.800)",f:"(8.000)",m:"(8.500)",t:"(24.300)"},
                    {c:"Taxas de cartão",j:"(5.600)",f:"(5.800)",m:"(6.300)",t:"(17.700)"},
                    {c:"Seguros e outros custos",j:"(8.800)",f:"(9.100)",m:"(9.500)",t:"(27.400)"},
                    {c:"Desgaste de equipamentos",j:"(5.800)",f:"(6.000)",m:"(6.200)",t:"(18.000)"},
                    {c:"Sangrias e retiradas extras",j:"(45.985)",f:"(43.450)",m:"(47.720)",t:"(137.155)"},
                  ]},
                {id:"lop",c:"= LUCRO DA OPERAÇÃO",j:"236.185",f:"(74.274)",m:"500.894",t:"662.805",d:true,tp:"lc"},
                {id:"fin",c:"(-) Resultado Financeiro + IR",j:"(20.400)",f:"(19.000)",m:"(21.800)",t:"(61.200)",d:false,tp:"x",
                  subs:[
                    {c:"(+) Rendimentos de aplicações",j:"1.800",f:"2.100",m:"2.500",t:"6.400"},
                    {c:"(-) Juros de empréstimos",j:"(4.200)",f:"(4.100)",m:"(4.300)",t:"(12.600)"},
                    {c:"(-) Parcelas de consórcio",j:"(6.000)",f:"(6.000)",m:"(6.000)",t:"(18.000)"},
                    {c:"(-) Impostos sobre o lucro (IR/CSLL)",j:"(12.000)",f:"(11.000)",m:"(14.000)",t:"(37.000)"},
                  ]},
                {id:"fl",c:"= LUCRO FINAL",j:"215.785",f:"(93.274)",m:"479.094",t:"601.605",d:true,tp:"fl"},
              ].map((r:any)=>{
                const aberto=dreAberto[r.id];
                const temSub=r.subs&&r.subs.length>0;
                return(<>
                  <tr key={r.id} onClick={()=>temSub&&setDreAberto({...dreAberto,[r.id]:!aberto})} style={{background:r.tp==="mg"?G+"10":r.tp==="lc"?GO+"10":r.tp==="fl"?GO+"18":"transparent",borderBottom:`0.5px solid ${BD}40`,cursor:temSub?"pointer":"default"}}>
                    <td style={{padding:6,fontWeight:r.d?700:400,color:r.d?TX:TXM}}>
                      {temSub&&<span style={{display:"inline-block",width:16,fontSize:10,color:GO}}>{aberto?"▼":"▶"}</span>}
                      {!temSub&&<span style={{display:"inline-block",width:16}}/>}
                      {r.c}
                    </td>
                    {[r.j,r.f,r.m,r.t].map((v:string,k:number)=><td key={k} style={{padding:6,textAlign:"right",fontWeight:r.d?700:400,color:v.includes("(")?R:["mg","lc","fl"].includes(r.tp)?GOL:TX}}>{v}</td>)}
                  </tr>
                  {aberto&&[...r.subs].sort((a:any,b:any)=>Math.abs(parseFloat(b.t.replace(/[().]/g,"").replace(",","")))-Math.abs(parseFloat(a.t.replace(/[().]/g,"").replace(",","")))).map((s:any,si:number)=>(
                    <tr key={`${r.id}-${si}`} style={{background:BG3,borderBottom:`0.5px solid ${BD}20`}}>
                      <td style={{padding:"4px 6px 4px 28px",fontSize:10,color:TXM}}>{s.c}</td>
                      {[s.j,s.f,s.m,s.t].map((v:string,k:number)=><td key={k} style={{padding:"4px 6px",textAlign:"right",fontSize:10,color:v.includes("(")?R+"CC":TXM}}>{v}</td>)}
                    </tr>
                  ))}
                </>);
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Tit t="Mapa de Custos — Do maior para o menor (clique para abrir)"/>
      <Card p="8px">
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:700}}>
            <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
              {["Grupo de Custo","Total 1T","Orçado 1T","Desvio","% Fat.","Análise e Sugestão da IA"].map(h=><th key={h} style={{padding:"8px 6px",textAlign:h==="Grupo de Custo"||h==="Análise e Sugestão da IA"?"left":"right",color:GOL,fontSize:9,letterSpacing:0.3}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {[
                {id:"cg_prod",g:"Produtos e Insumos",t_n:3138770,t:"3.138.770",orc:"2.974.500",orc_n:2974500,p:"48,3%",cor:R,
                  ia:"⚠ R$ 164K ACIMA do orçado. Custo dos painéis subiu 5% com câmbio. Renegociar com Risen e Canadian para contrato anual com preço fixo. Avaliar fornecedor nacional (BYD Manaus) para reduzir exposição ao dólar. Meta: voltar para 45% do faturamento.",
                  subs:[
                    {c:"Painéis solares (Risen, Canadian, JA)",t:"1.883.256",orc:"1.780.000"},
                    {c:"Inversores (Growatt, Fronius)",t:"627.756",orc:"610.000"},
                    {c:"Estruturas de fixação",t:"313.878",orc:"300.000"},
                    {c:"Cabos, conectores e proteções",t:"219.713",orc:"204.500"},
                    {c:"Outros materiais e componentes",t:"94.167",orc:"80.000"},
                  ]},
                {id:"cg_pess",g:"Pessoas (folha completa)",t_n:825500,t:"825.500",orc:"810.000",orc_n:810000,p:"12,7%",cor:Y,
                  ia:"Ligeiramente acima (+R$ 15,5K) por hora extra em março (projetos de usina). Dentro do aceitável. Atenção: equipe de Usinas (10 pessoas, R$ 68K/mês) ficou ociosa em fevereiro. Considerar contrato flexível para 3 instaladores de usina — fixo nos meses com projeto, dispensados nos meses sem.",
                  subs:[
                    {c:"Equipe direta dos 6 negócios (38 pessoas)",t:"684.000",orc:"660.000"},
                    {c:"Equipe administrativa (8 pessoas)",t:"87.500",orc:"96.000"},
                    {c:"Pró-labore dos sócios (3 sócios)",t:"54.500",orc:"54.000"},
                  ]},
                {id:"cg_com",g:"Comissões e Vendas",t_n:355000,t:"355.000",orc:"320.000",orc_n:320000,p:"5,5%",cor:Y,
                  ia:"⚠ R$ 35K acima do orçado porque o faturamento superou a meta em 9%. Comissão proporcional é esperada. Porém, revisar política: comissão sobre faturamento bruto não incentiva margem. Mudar para comissão sobre margem direta — vendedor passa a buscar projetos mais rentáveis, não apenas maiores.",
                  subs:[
                    {c:"Comissões vendedores (% sobre venda)",t:"245.000",orc:"220.000"},
                    {c:"Bônus por meta atingida",t:"58.000",orc:"52.000"},
                    {c:"Premiações e incentivos",t:"52.000",orc:"48.000"},
                  ]},
                {id:"cg_imp",g:"Impostos sobre Vendas",t_n:328420,t:"328.420",orc:"297.450",orc_n:297450,p:"5,1%",cor:Y,
                  ia:"Proporcional ao faturamento — sem ação corretiva. Porém, avaliar com contabilidade se o regime de Lucro Presumido ainda é o mais vantajoso. Com lucro de 10,2%, o Lucro Real pode gerar economia de R$ 40-80K/ano dependendo da composição dos custos dedutíveis.",
                  subs:[
                    {c:"ISS / ICMS",t:"162.500",orc:"148.000"},
                    {c:"COFINS",t:"123.425",orc:"112.000"},
                    {c:"PIS",t:"42.495",orc:"37.450"},
                  ]},
                {id:"cg_log",g:"Frete e Logística",t_n:296215,t:"296.215",orc:"270.000",orc_n:270000,p:"4,6%",cor:Y,
                  ia:"⚠ R$ 26K acima. Frete da Loja Online (R$ 44K grátis para cliente) é o principal desvio — representa 15% do custo total de frete para gerar apenas 2% do faturamento. Encerrar frete grátis ou descontinuar Loja Online elimina este desvio. Negociar contrato com transportadora regional para entregas locais.",
                  subs:[
                    {c:"Frete de equipamentos (fornecedor→sede)",t:"154.000",orc:"148.000"},
                    {c:"Frete de entrega (sede→cliente)",t:"98.215",orc:"92.000"},
                    {c:"Frete Loja Online (grátis para cliente)",t:"44.000",orc:"30.000"},
                  ]},
                {id:"cg_terc",g:"Terceirização e Serviços",t_n:252000,t:"252.000",orc:"240.000",orc_n:240000,p:"3,9%",cor:TXM,
                  ia:"Dentro do esperado (+R$ 12K). Custo aumenta proporcionalmente aos projetos de usina em março. Recomendação: formalizar contrato com 2-3 equipes terceirizadas com preço fechado por projeto — evita surpresas e garante disponibilidade nos meses de pico.",
                  subs:[
                    {c:"Instaladores terceirizados",t:"152.000",orc:"145.000"},
                    {c:"Eletricistas especializados",t:"55.000",orc:"52.000"},
                    {c:"Engenharia e projetos externos",t:"45.000",orc:"43.000"},
                  ]},
                {id:"cg_mkt",g:"Marketing (direto + institucional)",t_n:229300,t:"229.300",orc:"210.000",orc_n:210000,p:"3,5%",cor:TXM,
                  ia:"R$ 19K acima, mas gerou 9% a mais de faturamento — ROI positivo. Porém, R$ 18K/mês da Loja Online em marketing digital gera prejuízo. Realocar esse valor para: captação de contratos O&M (R$ 10K) e prospecção de projetos comerciais (R$ 8K). Retorno estimado: +R$ 150K/ano.",
                  subs:[
                    {c:"Marketing direto dos negócios",t:"205.000",orc:"190.000"},
                    {c:"Marketing institucional (marca)",t:"24.300",orc:"20.000"},
                  ]},
                {id:"cg_fin",g:"Financeiro (juros, parcelas, IR)",t_n:61200,t:"61.200",orc:"65.000",orc_n:65000,p:"0,9%",cor:TXM,
                  ia:"✓ R$ 3,8K ABAIXO do orçado. Juros diminuindo com amortização do Sicoob. Rendimentos de aplicações subindo (R$ 6,4K no tri). Manter estratégia atual: não antecipar BNDES (1,2% a.m. < rendimento aplicação) e acelerar Sicoob que será quitado em 10 meses.",
                  subs:[
                    {c:"Impostos sobre o lucro (IR/CSLL)",t:"37.000",orc:"38.000"},
                    {c:"Parcelas de consórcio",t:"18.000",orc:"18.000"},
                    {c:"Juros de empréstimos",t:"12.600",orc:"14.000"},
                    {c:"(-) Rendimentos de aplicações",t:"(6.400)",orc:"(5.000)"},
                  ]},
                {id:"cg_enc",g:"Encargos e Benefícios",t_n:54500,t:"54.500",orc:"55.000",orc_n:55000,p:"0,8%",cor:TXM,
                  ia:"✓ Dentro do orçado. Recomendação: avaliar plano de saúde coletivo por adesão (economia de 20-30% vs individual). Considerar vale alimentação via cartão flexível (iFood Benefícios) — mesma vantagem fiscal com maior satisfação da equipe.",
                  subs:[
                    {c:"INSS patronal",t:"25.100",orc:"25.000"},
                    {c:"FGTS",t:"14.700",orc:"15.000"},
                    {c:"Vale refeição / alimentação",t:"8.700",orc:"9.000"},
                    {c:"Plano de saúde",t:"3.600",orc:"3.600"},
                    {c:"Vale transporte",t:"2.400",orc:"2.400"},
                  ]},
                {id:"cg_seg",g:"Seguros, Taxas e Outros",t_n:45100,t:"45.100",orc:"42.000",orc_n:42000,p:"0,7%",cor:TXM,
                  ia:"Taxas de cartão subiram R$ 1,7K com aumento de vendas no crédito. Negociar taxa com Stone/PagSeguro — acima de R$ 200K/mês de faturamento no cartão, a taxa deve ser 2,5% e não 3,2%. Economia estimada: R$ 14K/ano. Contratar seguro RC profissional (obrigatório para instalações elétricas).",
                  subs:[
                    {c:"Taxas de cartão de crédito/débito",t:"17.700",orc:"15.000"},
                    {c:"Seguros (empresa + RC profissional)",t:"9.600",orc:"9.600"},
                    {c:"Perdas e quebras",t:"7.900",orc:"7.400"},
                    {c:"Outros custos diversos",t:"9.900",orc:"10.000"},
                  ]},
                {id:"cg_veic",g:"Veículos e Deslocamento",t_n:42100,t:"42.100",orc:"40.000",orc_n:40000,p:"0,6%",cor:TXM,
                  ia:"Ligeiramente acima (+R$ 2,1K). Combustível é o principal componente. Avaliar roteirização das visitas técnicas de manutenção (agrupar por região/dia) — pode reduzir 15-20% do consumo de combustível. Considerar 1 veículo elétrico para visitas urbanas — economia de R$ 800/mês em combustível.",
                  subs:[
                    {c:"Combustível (frota 6 veículos)",t:"22.100",orc:"21.000"},
                    {c:"Manutenção e revisões",t:"11.600",orc:"11.000"},
                    {c:"Seguro dos veículos",t:"8.400",orc:"8.000"},
                  ]},
                {id:"cg_adm",g:"Administrativo e Assessorias",t_n:40500,t:"40.500",orc:"39.000",orc_n:39000,p:"0,6%",cor:TXM,
                  ia:"✓ Controlado. O investimento em assessoria financeira (PS Gestão R$ 7,5K/tri) gera retorno comprovado: a análise de rateio revelou R$ 520K/ano de oportunidade em repricing. Softwares (Omie R$ 3K/tri) adequados para o porte. Avaliar CRM (Pipedrive ou RD Station CRM) para gestão de propostas — custo R$ 500/mês, retorno estimado +R$ 200K/ano em conversão.",
                  subs:[
                    {c:"Contabilidade",t:"13.500",orc:"13.500"},
                    {c:"Assessoria jurídica",t:"10.500",orc:"9.000"},
                    {c:"Assessoria financeira (PS Gestão)",t:"7.500",orc:"7.500"},
                    {c:"Softwares e sistemas (Omie, etc)",t:"9.000",orc:"9.000"},
                  ]},
                {id:"cg_ocup",g:"Ocupação (sede e estrutura física)",t_n:39700,t:"39.700",orc:"39.000",orc_n:39000,p:"0,6%",cor:TXM,
                  ia:"✓ Custo fixo estável e controlado. Aluguel de R$ 8,5K/mês para sede em Chapecó é adequado. Instalar energia solar na própria sede (5kWp) eliminaria R$ 2,8K/mês de energia — payback de 18 meses e benefício permanente. Seria também vitrine para clientes visitantes.",
                  subs:[
                    {c:"Aluguel da sede",t:"25.500",orc:"25.500"},
                    {c:"Energia elétrica",t:"8.500",orc:"8.000"},
                    {c:"Internet e telefonia",t:"3.600",orc:"3.600"},
                    {c:"Água e limpeza",t:"2.100",orc:"1.900"},
                  ]},
              ].sort((a,b)=>b.t_n-a.t_n).map((g:any)=>{
                const aberto=custoAberto[g.id];
                const desvio=g.t_n-g.orc_n;
                const desvio_p=((desvio/g.orc_n)*100).toFixed(1);
                return(<>
                  <tr key={g.id} onClick={()=>setCustoAberto({...custoAberto,[g.id]:!aberto})} style={{borderBottom:`0.5px solid ${BD}40`,cursor:"pointer",background:aberto?BG3:"transparent"}}>
                    <td style={{padding:"7px 6px",fontWeight:600,color:TX,minWidth:180}}>
                      <span style={{display:"inline-block",width:16,fontSize:10,color:GO}}>{aberto?"▼":"▶"}</span>
                      {g.g}
                    </td>
                    <td style={{padding:6,textAlign:"right",fontWeight:600,color:TX}}>{g.t}</td>
                    <td style={{padding:6,textAlign:"right",color:TXM}}>{g.orc}</td>
                    <td style={{padding:6,textAlign:"right",fontWeight:600,color:desvio>0?R:G,fontSize:10}}>
                      {desvio>0?`+${desvio.toLocaleString("pt-BR")}`:desvio<0?desvio.toLocaleString("pt-BR"):"—"}
                      <span style={{fontSize:8,marginLeft:3}}>({desvio>0?"+":""}{desvio_p}%)</span>
                    </td>
                    <td style={{padding:6,textAlign:"right",fontWeight:600,color:g.cor}}>{g.p}</td>
                    <td style={{padding:6,fontSize:9,color:TXD,maxWidth:250,lineHeight:1.3}}>{!aberto&&g.ia.substring(0,60)+"..."}</td>
                  </tr>
                  {aberto&&(<>
                    <tr key={`${g.id}-ia`} style={{background:g.ia.startsWith("✓")?G+"08":g.ia.startsWith("⚠")?Y+"08":BG3}}>
                      <td colSpan={6} style={{padding:"10px 14px 10px 28px",fontSize:10,color:TX,lineHeight:1.7,borderBottom:`0.5px solid ${BD}40`,borderLeft:`3px solid ${g.ia.startsWith("✓")?G:g.ia.startsWith("⚠")?Y:GO}`}}>
                        <span style={{fontWeight:600,color:GOL}}>Análise IA: </span>{g.ia}
                      </td>
                    </tr>
                    {[...g.subs].sort((a:any,b:any)=>Math.abs(parseFloat(b.t.replace(/[().]/g,"").replace(",","")))-Math.abs(parseFloat(a.t.replace(/[().]/g,"").replace(",","")))).map((s:any,si:number)=>{
                      const sReal=parseFloat(s.t.replace(/[().]/g,"").replace(/,/g,""));
                      const sOrc=parseFloat(s.orc.replace(/[().]/g,"").replace(/,/g,""));
                      const sDev=s.t.includes("(")?-(sReal-sOrc):(sReal-sOrc);
                      return(
                      <tr key={`${g.id}-${si}`} style={{background:BG3,borderBottom:`0.5px solid ${BD}20`}}>
                        <td style={{padding:"4px 6px 4px 28px",fontSize:10,color:TXM}}>{s.c}</td>
                        <td style={{padding:"4px 6px",textAlign:"right",fontSize:10,fontWeight:500,color:s.t.includes("(")?G:TXM}}>{s.t}</td>
                        <td style={{padding:"4px 6px",textAlign:"right",fontSize:10,color:TXD}}>{s.orc}</td>
                        <td style={{padding:"4px 6px",textAlign:"right",fontSize:9,color:sDev>0?R:sDev<0?G:TXD}}>
                          {sDev!==0?`${sDev>0?"+":""}${sDev.toLocaleString("pt-BR")}`:"—"}
                        </td>
                        <td style={{padding:"4px 6px"}}></td>
                        <td style={{padding:"4px 6px"}}></td>
                      </tr>);
                    })}
                  </>)}
                </>);
              })}
              <tr style={{background:GO+"18",borderTop:`1px solid ${GO}`}}>
                <td style={{padding:"8px 6px",fontWeight:700,color:TX,paddingLeft:22}}>TOTAL CUSTOS E DESPESAS</td>
                <td style={{padding:6,textAlign:"right",fontWeight:700,color:R}}>5.898.395</td>
                <td style={{padding:6,textAlign:"right",fontWeight:700,color:TXM}}>5.601.950</td>
                <td style={{padding:6,textAlign:"right",fontWeight:700,color:R,fontSize:10}}>+296.445 (+5,3%)</td>
                <td style={{padding:6,textAlign:"right",fontWeight:700,color:R}}>90,7%</td>
                <td style={{padding:6,fontSize:9,color:GOL}}>Custos subiram 5,3% mas faturamento subiu 9,3% — margem melhorou</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Tit t="Parecer da Inteligência Artificial — Análise do Período"/>
      <Card>
        <div style={{background:GO+"10",borderRadius:10,padding:16,marginBottom:12,borderLeft:`4px solid ${GO}`}}>
          <div style={{fontSize:12,fontWeight:700,color:GOL,marginBottom:8}}>◆ DIAGNÓSTICO GERAL DO TRIMESTRE</div>
          <div style={{fontSize:12,color:TX,lineHeight:1.8}}>
            A empresa faturou R$ 6,5 milhões no 1º trimestre com custo total de R$ 5,9 milhões (90,7% do faturamento), gerando lucro final de R$ 601.605. Os custos ficaram R$ 296 mil acima do orçado (+5,3%), porém o faturamento superou a meta em 9,3% — o que significa que a empresa gastou mais porque vendeu mais, e a margem líquida melhorou de 8,7% (orçado) para 9,3% (realizado). O resultado é positivo, mas existem ineficiências que se corrigidas podem adicionar R$ 780 mil ao lucro anual.
          </div>
        </div>
      </Card>

      <Card>
        <div style={{fontSize:12,fontWeight:700,color:R,marginBottom:12}}>🔴 PONTOS CRÍTICOS (ação imediata)</div>
        {[
          {t:"Custo de produtos 3 pontos acima do ideal",d:"Os produtos e insumos consomem 48,3% do faturamento — a meta é 45%. A diferença de 3 pontos equivale a R$ 195 mil por trimestre ou R$ 780 mil por ano de lucro perdido. A causa principal é o aumento de 5% no preço dos painéis solares importados (câmbio). Ação: renegociar contrato anual com Risen e Canadian Solar com preço fixo, e testar fornecedor nacional (BYD Manaus).",imp:"Impacto: +R$ 780K/ano",cor:R},
          {t:"Loja Online destruindo valor em 3 frentes",d:"Consome R$ 44K em frete grátis (15% do custo total de frete para gerar 2% do faturamento), R$ 54K em marketing digital com retorno negativo, e R$ 7,9K em perdas/quebras acima da média. Cada mês que passa, a empresa perde R$ 8K. Ação: encerrar operação em 30 dias e realocar recursos para Manutenção O&M.",imp:"Impacto: +R$ 234K/ano",cor:R},
          {t:"Política de comissões incentiva volume, não margem",d:"Vendedores ganham comissão sobre faturamento bruto, não sobre margem. Isso significa que um projeto de R$ 500K com 5% de margem gera mais comissão que um de R$ 200K com 25% de margem — mesmo que o segundo dê 2x mais lucro. Ação: migrar comissão para % da margem direta.",imp:"Impacto: +R$ 120K/ano",cor:R},
        ].map((p,i)=>(
          <div key={i} style={{background:R+"08",borderRadius:8,padding:14,marginBottom:8,borderLeft:`3px solid ${R}`}}>
            <div style={{fontSize:12,fontWeight:600,color:R,marginBottom:4}}>{p.t}</div>
            <div style={{fontSize:11,color:TX,lineHeight:1.7,marginBottom:6}}>{p.d}</div>
            <div style={{fontSize:11,fontWeight:600,color:G,background:G+"10",display:"inline-block",padding:"2px 10px",borderRadius:4}}>{p.imp}</div>
          </div>
        ))}
      </Card>

      <Card>
        <div style={{fontSize:12,fontWeight:700,color:Y,marginBottom:12}}>🟡 PONTOS DE ATENÇÃO (agir em 30-60 dias)</div>
        {[
          {t:"Equipe de Usinas ociosa em meses sem projeto",d:"10 profissionais com custo fixo de R$ 68K/mês ficaram sem projeto em fevereiro. A folha continuou mesmo com faturamento zero. Ação: converter 3 instaladores para contrato por projeto (reduz custo fixo em R$ 24K/mês) e nos meses sem usina, realocar equipe técnica para Projetos Comerciais.",imp:"Economia: R$ 72K/ano"},
          {t:"Taxas de cartão acima do mercado",d:"As taxas de cartão estão em 3,2% do valor — para faturamento acima de R$ 200K/mês no cartão, a taxa negociada deveria ser 2,5%. Ação: renegociar com Stone ou PagSeguro apresentando o volume mensal.",imp:"Economia: R$ 14K/ano"},
          {t:"Frete poderia ser otimizado com roteirização",d:"Os veículos de manutenção fazem visitas sem agrupamento geográfico. Roteirizar por região e dia pode reduzir 15-20% do consumo de combustível. Ação: implementar roteirização semanal das visitas.",imp:"Economia: R$ 16K/ano"},
          {t:"Regime tributário pode não ser o mais vantajoso",d:"Com lucro de 10,2%, o Lucro Presumido pode estar custando mais que o Lucro Real. Ação: pedir simulação comparativa ao escritório de contabilidade com dados dos últimos 12 meses.",imp:"Economia potencial: R$ 40-80K/ano"},
        ].map((p,i)=>(
          <div key={i} style={{background:Y+"08",borderRadius:8,padding:14,marginBottom:8,borderLeft:`3px solid ${Y}`}}>
            <div style={{fontSize:12,fontWeight:600,color:Y,marginBottom:4}}>{p.t}</div>
            <div style={{fontSize:11,color:TX,lineHeight:1.7,marginBottom:6}}>{p.d}</div>
            <div style={{fontSize:11,fontWeight:600,color:G,background:G+"10",display:"inline-block",padding:"2px 10px",borderRadius:4}}>{p.imp}</div>
          </div>
        ))}
      </Card>

      <Card>
        <div style={{fontSize:12,fontWeight:700,color:G,marginBottom:12}}>🟢 OPORTUNIDADES DE MELHORIA (próximos 90 dias)</div>
        {[
          {t:"Triplicar base de contratos de Manutenção (158→500)",d:"Cada contrato novo gera R$ 300/mês com 20,4% de lucro real e custo de aquisição de apenas R$ 350. Contratar +2 técnicos e +1 vendedor dedicado. Investimento: R$ 13K/mês. Retorno: R$ 99K/mês em 12 meses.",imp:"+R$ 1,2M/ano"},
          {t:"Corrigir tabela de preços com custo real da estrutura",d:"A ficha técnica M16 já calcula o preço sugerido incluindo rateio da sede. Basta adotar esses preços. O markup real médio subiria de 11,2% para 18,5% nos Equipamentos.",imp:"+R$ 520K/ano"},
          {t:"Instalar energia solar na própria sede",d:"Sistema de 5kWp eliminaria R$ 2,8K/mês de conta de energia. Payback de 18 meses. Além da economia, serve como vitrine para clientes que visitam a empresa.",imp:"+R$ 33K/ano"},
          {t:"Implementar CRM para gestão de propostas",d:"Hoje as propostas são controladas em planilha. Um CRM (Pipedrive, R$ 500/mês) melhora acompanhamento, acelera fechamento e evita propostas esquecidas. Estimativa de conversão adicional: 2 projetos/mês.",imp:"+R$ 200K/ano"},
          {t:"Realocar marketing da Loja Online para O&M",d:"Os R$ 18K/mês gastos em marketing digital da Loja Online (com retorno negativo) seriam muito mais produtivos captando contratos de manutenção (R$ 10K) e projetos comerciais (R$ 8K).",imp:"+R$ 150K/ano"},
        ].map((p,i)=>(
          <div key={i} style={{background:G+"08",borderRadius:8,padding:14,marginBottom:8,borderLeft:`3px solid ${G}`}}>
            <div style={{fontSize:12,fontWeight:600,color:G,marginBottom:4}}>{p.t}</div>
            <div style={{fontSize:11,color:TX,lineHeight:1.7,marginBottom:6}}>{p.d}</div>
            <div style={{fontSize:11,fontWeight:700,color:G,background:G+"15",display:"inline-block",padding:"2px 10px",borderRadius:4}}>{p.imp}</div>
          </div>
        ))}
      </Card>

      <Card>
        <div style={{background:BG3,borderRadius:10,padding:16,border:`1px solid ${GO}40`}}>
          <div style={{fontSize:12,fontWeight:700,color:GOL,marginBottom:8}}>◆ RESUMO DO IMPACTO TOTAL</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
            <div style={{background:BG2,borderRadius:8,padding:10,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD}}>Pontos Críticos</div>
              <div style={{fontSize:18,fontWeight:700,color:G}}>+R$ 1,13M</div>
              <div style={{fontSize:9,color:TXM}}>por ano se corrigidos</div>
            </div>
            <div style={{background:BG2,borderRadius:8,padding:10,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD}}>Pontos de Atenção</div>
              <div style={{fontSize:18,fontWeight:700,color:G}}>+R$ 182K</div>
              <div style={{fontSize:9,color:TXM}}>por ano em economia</div>
            </div>
            <div style={{background:BG2,borderRadius:8,padding:10,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD}}>Oportunidades</div>
              <div style={{fontSize:18,fontWeight:700,color:G}}>+R$ 2,1M</div>
              <div style={{fontSize:9,color:TXM}}>por ano em crescimento</div>
            </div>
          </div>
          <div style={{textAlign:"center",background:GO+"15",borderRadius:8,padding:12}}>
            <div style={{fontSize:10,color:TXD}}>IMPACTO TOTAL SE TODAS AS AÇÕES FOREM EXECUTADAS</div>
            <div style={{fontSize:28,fontWeight:800,color:GOL,margin:"4px 0"}}>+R$ 3,4 milhões/ano</div>
            <div style={{fontSize:11,color:TX}}>Lucro anual passaria de R$ 2,4M para R$ 5,8M — aumento de <strong style={{color:G}}>141%</strong></div>
          </div>
        </div>
      </Card>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
        <div style={{background:BG2,borderRadius:8,padding:12,textAlign:"center",border:`0.5px solid ${BD}`}}>
          <div style={{fontSize:9,color:TXD}}>Faturamento Mínimo / Mês</div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>R$ 978K</div>
          <div style={{fontSize:9,color:TXM}}>Abaixo disso, dá prejuízo</div>
        </div>
        <div style={{background:BG2,borderRadius:8,padding:12,textAlign:"center",border:`0.5px solid ${BD}`}}>
          <div style={{fontSize:9,color:TXD}}>Custo Estrutura / Mês</div>
          <div style={{fontSize:20,fontWeight:700,color:Y}}>R$ 181K</div>
          <div style={{fontSize:9,color:TXM}}>Sede, ADM, veículos</div>
        </div>
      </div>
      </>)}
    </div>)}

    {aba==="precos"&&(<div>
      <Tit t="Clique em um negócio para ver seus produtos e preços"/>
      {negocios.map(n=>(
        <div key={n.id} onClick={()=>{setLnAberta(n.id);setSubAba("produtos");}} style={{background:BG2,borderRadius:10,padding:"12px 14px",marginBottom:6,borderLeft:`4px solid ${n.cor}`,border:`0.5px solid ${BD}`,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:13,fontWeight:600,color:TX}}>{n.nome}</div><div style={{fontSize:9,color:TXD}}>{n.produtos.length} produtos cadastrados</div></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:700,color:n.produtos[0].m>50?G:GO}}>{n.produtos[0].m}%</div><div style={{fontSize:8,color:TXD}}>melhor margem</div></div>
            <span style={{color:GO,fontSize:16}}>›</span>
          </div>
        </div>
      ))}
    </div>)}

    {aba==="relatorio"&&(<div>
      <Tit t="Gerar Relatório Completo"/>
      <Card>
        <div style={{fontSize:11,color:TXD,marginBottom:8}}>Período</div>
        <select style={{marginBottom:12,background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"10px 14px",fontSize:14,width:"100%"}}><option>Janeiro a Março de 2025</option></select>
        <div style={{fontSize:11,color:TXD,marginBottom:8}}>Tipo</div>
        <select style={{marginBottom:16,background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"10px 14px",fontSize:14,width:"100%"}}><option>Completo — 20 análises + gráficos</option><option>Resumido — 5 análises</option></select>
        <button style={{width:"100%",padding:14,border:"none",borderRadius:10,background:`linear-gradient(135deg,${GO} 0%,${GOL} 100%)`,color:BG,fontSize:15,fontWeight:700}}>◆ Gerar Relatório</button>
      </Card>
    </div>)}

    </div>

    <div style={{textAlign:"center",padding:"24px 16px 20px",borderTop:`1px solid ${BD}`,marginTop:40}}>
      <div style={{fontSize:11,fontWeight:600,color:GOL}}>PS Gestão e Capital</div>
      <div style={{fontSize:9,color:TXD,marginTop:4}}>Assessoria Empresarial e BPO Financeiro</div>
      <div style={{fontSize:8,color:TXD,marginTop:4}}>v4.7 — filtro período</div>
    </div>
  </div>);
}
