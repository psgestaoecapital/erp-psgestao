"use client";
import { useState } from "react";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";

const GO="#C6973F",GOL="#E8C872",BG="#0F0F0D",BG2="#1C1B18",BG3="#2A2822",
    G="#22C55E",R="#EF4444",Y="#FACC15",B="#3B82F6",P="#A855F7",T="#14B8A6",
    BD="#3D3A30",TX="#E8E5DC",TXM="#A8A498",TXD="#6B6960";

const tt={background:'#FFFFFF',border:'2px solid #C6973F',borderRadius:10,fontSize:12,color:'#1A1A18',padding:'10px 14px',boxShadow:'0 4px 12px rgba(0,0,0,0.3)'};
const tl={color:'#1A1A18',fontWeight:600};const ti={color:'#1A1A18'};

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

  const abas=[{id:"geral",nome:"Painel Geral"},{id:"negocios",nome:"Negócios"},{id:"resultado",nome:"Resultado"},{id:"financeiro",nome:"Financeiro"},{id:"precos",nome:"Preços"},{id:"relatorio",nome:"Relatório"}];
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
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={(v:any)=>[`R$ ${v}K`]}/>
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
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={(v:any)=>[`${v}%`]}/>
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
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={(v:any)=>[`${v}%`]}/>
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
  return(<div>
    <div style={{padding:"12px 20px",background:BG2,borderBottom:`1px solid ${BD}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:14,color:GOL,fontWeight:600}}>{empresa.nome}</div><div style={{fontSize:10,color:TXD}}>{empresa.cidade} | {empresa.lns} negócios | {empresa.colab} colaboradores</div></div>
        <div style={{fontSize:10,color:TXM,background:BG3,padding:"4px 10px",borderRadius:6,border:`0.5px solid ${BD}`}}>{empresa.periodo}</div>
      </div>
    </div>

    <div style={{display:"flex",gap:3,padding:"8px 12px",overflowX:"auto",borderBottom:`1px solid ${BD}`}}>
      {abas.map(a=>(<button key={a.id} onClick={()=>setAba(a.id)} style={{padding:"7px 14px",borderRadius:20,fontSize:11,whiteSpace:"nowrap",border:`0.5px solid ${aba===a.id?GO:BD}`,background:aba===a.id?GO+"18":"transparent",color:aba===a.id?GOL:TXM,fontWeight:aba===a.id?600:400}}>{a.nome}</button>))}
    </div>

    <div style={{padding:"14px 20px",maxWidth:1200,margin:"0 auto"}}>

    {aba==="geral"&&(<div>
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
            <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={(v:any)=>[`R$ ${v}K`]}/>
            <Area type="monotone" dataKey="fat" stroke={GO} fill="url(#gF)" strokeWidth={2} name="Faturamento"/>
            <Line type="monotone" dataKey="lucro" stroke={G} strokeWidth={2.5} dot={{r:5,fill:G}} name="Lucro"/>
            <Line type="monotone" dataKey="estr" stroke={R} strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Custo Estrutura"/>
          </AreaChart>
        </ResponsiveContainer>
      </Card>

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
    </div>)}

    {aba==="financeiro"&&(<div>
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
            <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={(v:any)=>[`R$ ${v}K`]}/>
            <Line type="monotone" dataKey="disp" stroke={G} strokeWidth={2.5} dot={{r:5,fill:G}} name="Disponível"/>
            <Line type="monotone" dataKey="div" stroke={R} strokeWidth={2} dot={{r:4,fill:R}} name="Dívidas"/>
            <Line type="monotone" dataKey="saldo" stroke={GOL} strokeWidth={2.5} strokeDasharray="5 5" dot={{r:5,fill:GOL}} name="Saldo"/>
          </LineChart>
        </ResponsiveContainer>
        <div style={{background:G+"15",borderRadius:8,padding:10,marginTop:8,textAlign:"center",border:`0.5px solid ${G}40`}}>
          <div style={{fontSize:11,fontWeight:600,color:G}}>✓ Março: caixa superou dívidas pela primeira vez</div>
        </div>
      </Card>
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
      <Tit t="Resultado Financeiro Completo"/>
      <Card p="8px">
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:500}}>
            <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
              {["","Jan","Fev","Mar","Total 1T"].map(h=><th key={h} style={{padding:"8px 6px",textAlign:h===""?"left":"right",color:GOL,fontSize:10}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {[{c:"FATURAMENTO BRUTO",j:"2.226.400",f:"1.144.200",m:"3.129.400",t:"6.500.000",d:true,tp:"fat"},
                {c:"(-) Devoluções + Impostos",j:"(122.040)",f:"(68.940)",m:"(172.375)",t:"(363.355)",d:false,tp:"x"},
                {c:"= FATURAMENTO LÍQUIDO",j:"2.104.360",f:"1.075.260",m:"2.957.025",t:"6.136.645",d:true,tp:"sub"},
                {c:"(-) Custos Diretos (6 negócios)",j:"(1.689.690)",f:"(970.884)",m:"(2.270.411)",t:"(4.930.985)",d:false,tp:"x"},
                {c:"= MARGEM DIRETA",j:"414.670",f:"104.376",m:"686.614",t:"1.205.660",d:true,tp:"mg"},
                {c:"(-) Custo Estrutura Central",j:"(178.485)",f:"(178.650)",m:"(185.720)",t:"(542.855)",d:false,tp:"x"},
                {c:"= LUCRO DA OPERAÇÃO",j:"236.185",f:"(74.274)",m:"500.894",t:"662.805",d:true,tp:"lc"},
                {c:"(-) Desgaste + Juros + IR",j:"(20.400)",f:"(19.000)",m:"(21.800)",t:"(61.200)",d:false,tp:"x"},
                {c:"= LUCRO FINAL",j:"215.785",f:"(93.274)",m:"479.094",t:"601.605",d:true,tp:"fl"},
              ].map((r,i)=><tr key={i} style={{background:r.tp==="mg"?G+"10":r.tp==="lc"?GO+"10":r.tp==="fl"?GO+"18":"transparent",borderBottom:`0.5px solid ${BD}40`}}>
                <td style={{padding:6,fontWeight:r.d?700:400,color:r.d?TX:TXM}}>{r.c}</td>
                {[r.j,r.f,r.m,r.t].map((v,k)=><td key={k} style={{padding:6,textAlign:"right",fontWeight:r.d?700:400,color:v.includes("(")?R:["mg","lc","fl"].includes(r.tp)?GOL:TX}}>{v}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
      </Card>
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
    </div>
  </div>);
}
