"use client";
import React, { useState } from "react";
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",ow:"#FAF7F2",g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",pk:"#EC4899",bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};
const fR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fP=(v:number)=>`${v.toFixed(1)}%`;

// ═══ DADOS SIMULADOS DE OPERAÇÃO ═══
const CLIENTES=[
  {id:1,nome:"Tryo Gessos Ltda",plano:"ERP PRO",mrr:5000,status:"ativo",ultimoLogin:"2026-04-10 16:42",v19Gerados:8,consultasIA:45,armazenamento:128,modulosAtivos:["Dashboard","BPO","V19","Consultor"],diasAtivo:6,empresas:4},
  {id:2,nome:"VP Contabilidade",plano:"BPO Escritório",mrr:8000,status:"trial",ultimoLogin:"2026-04-10 15:20",v19Gerados:2,consultasIA:12,armazenamento:45,modulosAtivos:["Dashboard","BPO"],diasAtivo:1,empresas:12},
  {id:3,nome:"Frioeste Ltda",plano:"Industrial",mrr:15000,status:"proposta",ultimoLogin:"—",v19Gerados:0,consultasIA:0,armazenamento:0,modulosAtivos:[],diasAtivo:0,empresas:1},
  {id:4,nome:"Airton Camargo",plano:"Wealth MFO",mrr:5000,status:"ativo",ultimoLogin:"2026-04-09 11:30",v19Gerados:0,consultasIA:8,armazenamento:22,modulosAtivos:["Wealth"],diasAtivo:3,empresas:0},
  {id:5,nome:"P10 Franchising",plano:"ERP Franquias",mrr:3000,status:"implantação",ultimoLogin:"2026-04-08 09:15",v19Gerados:1,consultasIA:5,armazenamento:18,modulosAtivos:["Dashboard"],diasAtivo:6,empresas:1},
  {id:6,nome:"Escritório Alfa",plano:"BPO Consultor",mrr:2000,status:"trial",ultimoLogin:"2026-04-10 14:05",v19Gerados:3,consultasIA:22,armazenamento:65,modulosAtivos:["Dashboard","BPO","V19"],diasAtivo:4,empresas:8},
  {id:7,nome:"Indústria Beta",plano:"Industrial",mrr:12000,status:"proposta",ultimoLogin:"—",v19Gerados:0,consultasIA:0,armazenamento:0,modulosAtivos:[],diasAtivo:0,empresas:1},
  {id:8,nome:"Consultoria Gama",plano:"ERP PRO",mrr:5000,status:"trial",ultimoLogin:"2026-04-07 10:20",v19Gerados:1,consultasIA:3,armazenamento:32,modulosAtivos:["Dashboard","Consultor"],diasAtivo:3,empresas:3},
];

const SERVICOS=[
  {nome:"Supabase (PostgreSQL)",status:"online",uptime:99.98,latencia:12,ultimo:"Agora",cor:C.g},
  {nome:"Vercel (Aplicação)",status:"online",uptime:99.99,latencia:45,ultimo:"Agora",cor:C.g},
  {nome:"Anthropic Claude API",status:"online",uptime:99.2,latencia:2800,ultimo:"Agora",cor:C.g},
  {nome:"GitHub (Código)",status:"online",uptime:99.95,latencia:120,ultimo:"Agora",cor:C.g},
  {nome:"Omie API",status:"online",uptime:99.5,latencia:850,ultimo:"Agora",cor:C.g},
  {nome:"Nibo API",status:"online",uptime:99.3,latencia:920,ultimo:"Agora",cor:C.g},
];

const ERROS_24H=[
  {hora:"16:42",tipo:"IA Overloaded",modulo:"Consultor",cliente:"Tryo Gessos",resolvido:true},
  {hora:"15:18",tipo:"IA Overloaded",modulo:"V19",cliente:"Escritório Alfa",resolvido:true},
  {hora:"14:55",tipo:"IA Overloaded",modulo:"Consultor",cliente:"Tryo Gessos",resolvido:true},
  {hora:"11:20",tipo:"Timeout API",modulo:"Omie Sync",cliente:"Tryo Gessos",resolvido:true},
  {hora:"09:05",tipo:"Erro OFX parse",modulo:"BPO Conciliação",cliente:"Escritório Alfa",resolvido:false},
];

const CONSUMO_IA=[
  {dia:"04/04",tokens:45200,custo:1.82,v19:2,consultas:8},
  {dia:"05/04",tokens:38400,custo:1.54,v19:1,consultas:12},
  {dia:"06/04",tokens:52100,custo:2.10,v19:3,consultas:15},
  {dia:"07/04",tokens:28900,custo:1.16,v19:1,consultas:6},
  {dia:"08/04",tokens:89500,custo:3.60,v19:5,consultas:22},
  {dia:"09/04",tokens:124800,custo:5.02,v19:8,consultas:35},
  {dia:"10/04",tokens:156200,custo:6.28,v19:12,consultas:48},
];

const LOGINS_7D=[
  {dia:"04/04",total:4,falhas:0},{dia:"05/04",total:6,falhas:1},{dia:"06/04",total:8,falhas:0},
  {dia:"07/04",total:5,falhas:0},{dia:"08/04",total:12,falhas:2},{dia:"09/04",total:15,falhas:1},
  {dia:"10/04",total:22,falhas:3},
];

const ANTIFRAUDE={boletosAnalisados:48,fraudesDetectadas:3,valorBloqueado:148000,scoreMedio:72};

// ═══ COMPONENTES ═══
const Card=({children,title,color=C.gol}:{children:React.ReactNode;title?:string;color?:string})=>(
  <div style={{background:C.bg2,borderRadius:10,padding:12,border:`1px solid ${C.bd}`,marginBottom:10}}>
    {title&&<div style={{fontSize:12,fontWeight:700,color,marginBottom:8,paddingBottom:6,borderBottom:`1px solid ${C.bd}`}}>{title}</div>}
    {children}
  </div>
);
const KPI=({l,v,s,c=C.gol}:{l:string;v:string;s?:string;c?:string})=>(
  <div style={{background:C.bg3,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${c}`}}>
    <div style={{fontSize:7,color:C.txd,textTransform:"uppercase",letterSpacing:0.5}}>{l}</div>
    <div style={{fontSize:18,fontWeight:700,color:c,marginTop:1}}>{v}</div>
    {s&&<div style={{fontSize:7,color:C.txm,marginTop:1}}>{s}</div>}
  </div>
);

export default function NOCDashboard(){
  const [tab,setTab]=useState("geral");
  const tabs=[
    {id:"geral",l:"📊 Visão Geral",c:C.gol},{id:"clientes",l:"👥 Clientes",c:C.g},
    {id:"sistema",l:"🖥️ Sistema",c:C.b},{id:"ia",l:"🤖 IA & Consumo",c:C.p},
    {id:"seguranca",l:"🛡️ Segurança",c:C.r},{id:"financeiro",l:"💰 Financeiro",c:C.or},
  ];

  const ativos=CLIENTES.filter(c=>c.status==="ativo");
  const trials=CLIENTES.filter(c=>c.status==="trial");
  const mrrTotal=CLIENTES.filter(c=>c.status==="ativo"||c.status==="trial").reduce((s,c)=>s+c.mrr,0);
  const pipeline=CLIENTES.filter(c=>c.status==="proposta"||c.status==="implantação");
  const armazTotal=CLIENTES.reduce((s,c)=>s+c.armazenamento,0);
  const custoIA=CONSUMO_IA.reduce((s,d)=>s+d.custo,0);
  const tokensTotal=CONSUMO_IA.reduce((s,d)=>s+d.tokens,0);

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background:"linear-gradient(135deg,#1a0a05,#0C0C0A)",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:C.gol}}>🖥️ PS Gestão — Painel de Operações (NOC)</div>
          <div style={{fontSize:10,color:C.txm}}>Monitoramento em Tempo Real | Clientes, Sistema, IA, Segurança, Financeiro</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{padding:"4px 10px",borderRadius:6,background:C.g+"20",border:`1px solid ${C.g}40`,fontSize:10,color:C.g,fontWeight:600}}>● TODOS SERVIÇOS ONLINE</div>
          <div style={{padding:"4px 10px",borderRadius:6,background:C.bg3,fontSize:10,color:C.txm}}>10/04/2026 21:18</div>
          <a href="/dashboard" style={{padding:"4px 10px",border:`1px solid ${C.bd}`,borderRadius:6,color:C.txm,fontSize:10,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      <div style={{display:"flex",gap:2,padding:"6px 12px",background:C.bg2,overflowX:"auto",borderBottom:`1px solid ${C.bd}`}}>
        {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:tab===t.id?700:500,background:tab===t.id?t.c+"20":"transparent",color:tab===t.id?t.c:C.txm,whiteSpace:"nowrap"}}>{t.l}</button>)}
      </div>

      <div style={{padding:"10px 12px",maxWidth:1400,margin:"0 auto"}}>

      {/* ═══ VISÃO GERAL ═══ */}
      {tab==="geral"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Clientes Ativos" v={`${ativos.length}`} s={`+${trials.length} trial`} c={C.g}/>
          <KPI l="MRR" v={fR(mrrTotal)} s="Receita mensal recorrente" c={C.g}/>
          <KPI l="Pipeline" v={`${pipeline.length}`} s={fR(pipeline.reduce((s,c)=>s+c.mrr,0))+" potencial"} c={C.y}/>
          <KPI l="Armazenamento" v={`${armazTotal} MB`} s="de 500 MB (Free)" c={armazTotal>400?C.y:C.g}/>
          <KPI l="Erros 24h" v={`${ERROS_24H.length}`} s={`${ERROS_24H.filter(e=>!e.resolvido).length} pendente`} c={ERROS_24H.filter(e=>!e.resolvido).length>0?C.r:C.g}/>
          <KPI l="Custo IA (7 dias)" v={`R$ ${custoIA.toFixed(2)}`} s={`${(tokensTotal/1000).toFixed(0)}K tokens`} c={C.p}/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Card title="🖥️ Status dos Serviços" color={C.b}>
            {SERVICOS.map((sv,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`0.5px solid ${C.bd}20`,alignItems:"center"}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:8,height:8,borderRadius:4,background:sv.cor}}/>
                  <span style={{fontSize:10,color:C.tx}}>{sv.nome}</span>
                </div>
                <div style={{display:"flex",gap:12}}>
                  <span style={{fontSize:9,color:C.txm}}>{sv.latencia}ms</span>
                  <span style={{fontSize:9,color:C.g}}>{sv.uptime}%</span>
                </div>
              </div>
            ))}
          </Card>

          <Card title="⚠️ Erros Últimas 24h" color={C.r}>
            {ERROS_24H.map((e,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`0.5px solid ${C.bd}20`,fontSize:10}}>
                <div>
                  <span style={{color:C.txd,marginRight:8}}>{e.hora}</span>
                  <span style={{color:e.resolvido?C.txm:C.r,fontWeight:e.resolvido?400:600}}>{e.tipo}</span>
                  <span style={{color:C.txd,marginLeft:6}}>({e.modulo})</span>
                </div>
                <span style={{color:e.resolvido?C.g:C.r,fontSize:9}}>{e.resolvido?"✅ Resolvido":"🔴 Pendente"}</span>
              </div>
            ))}
          </Card>
        </div>

        <Card title="👥 Últimos Acessos" color={C.gol}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
            {CLIENTES.filter(c=>c.ultimoLogin!=="—").sort((a,b)=>b.ultimoLogin.localeCompare(a.ultimoLogin)).slice(0,8).map((cl,i)=>(
              <div key={i} style={{background:C.bg3,borderRadius:6,padding:8,borderLeft:`2px solid ${cl.status==="ativo"?C.g:cl.status==="trial"?C.y:C.txd}`}}>
                <div style={{fontSize:10,fontWeight:600,color:C.tx,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cl.nome}</div>
                <div style={{fontSize:8,color:C.txd}}>{cl.ultimoLogin}</div>
                <div style={{fontSize:8,color:cl.status==="ativo"?C.g:C.y,marginTop:2}}>{cl.plano}</div>
              </div>
            ))}
          </div>
        </Card>
      </>)}

      {/* ═══ CLIENTES ═══ */}
      {tab==="clientes"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Total Clientes" v={`${CLIENTES.length}`} c={C.b}/>
          <KPI l="Ativos" v={`${ativos.length}`} c={C.g}/>
          <KPI l="Trial" v={`${trials.length}`} c={C.y}/>
          <KPI l="Propostas" v={`${CLIENTES.filter(c=>c.status==="proposta").length}`} c={C.or}/>
          <KPI l="Empresas Gerenciadas" v={`${CLIENTES.reduce((s,c)=>s+c.empresas,0)}`} c={C.gol}/>
        </div>
        <Card title="📋 Todos os Clientes">
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
              {["Cliente","Plano","MRR","Status","Último Login","V19","Consultas IA","Empresas","Armaz.","Risco"].map(h=>
                <th key={h} style={{padding:"6px 4px",textAlign:h==="Cliente"?"left":"center",color:C.gol,fontSize:8}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {CLIENTES.map(cl=>{
                const diasSemLogin=cl.ultimoLogin==="—"?999:Math.floor((Date.now()-new Date(cl.ultimoLogin.replace(" ","T")).getTime())/86400000);
                const risco=cl.status==="proposta"?"—":diasSemLogin>7?"🔴 Alto":diasSemLogin>3?"🟡 Médio":"🟢 Baixo";
                return(
                  <tr key={cl.id} style={{borderBottom:`0.5px solid ${C.bd}20`}}>
                    <td style={{padding:"5px 4px",color:C.tx,fontWeight:600}}>{cl.nome}</td>
                    <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{cl.plano}</td>
                    <td style={{padding:"5px 4px",textAlign:"center",color:C.g,fontWeight:600}}>{fR(cl.mrr)}</td>
                    <td style={{padding:"5px 4px",textAlign:"center"}}>
                      <span style={{padding:"2px 6px",borderRadius:4,fontSize:8,fontWeight:600,
                        background:cl.status==="ativo"?C.g+"20":cl.status==="trial"?C.y+"20":cl.status==="implantação"?C.b+"20":C.txd+"20",
                        color:cl.status==="ativo"?C.g:cl.status==="trial"?C.y:cl.status==="implantação"?C.b:C.txd,
                      }}>{cl.status}</span>
                    </td>
                    <td style={{padding:"5px 4px",textAlign:"center",fontSize:9,color:C.txm}}>{cl.ultimoLogin}</td>
                    <td style={{padding:"5px 4px",textAlign:"center",color:C.p}}>{cl.v19Gerados}</td>
                    <td style={{padding:"5px 4px",textAlign:"center",color:C.p}}>{cl.consultasIA}</td>
                    <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{cl.empresas}</td>
                    <td style={{padding:"5px 4px",textAlign:"center",color:C.txm}}>{cl.armazenamento>0?`${cl.armazenamento}MB`:"—"}</td>
                    <td style={{padding:"5px 4px",textAlign:"center",fontSize:9}}>{risco}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </>)}

      {/* ═══ SISTEMA ═══ */}
      {tab==="sistema"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Uptime Geral" v="99.9%" s="Últimos 30 dias" c={C.g}/>
          <KPI l="Armazenamento" v={`${armazTotal} MB`} s={`${fP(armazTotal/500*100)} de 500 MB`} c={armazTotal>400?C.y:C.g}/>
          <KPI l="Deploys Hoje" v="5" s="Último: 16:46" c={C.b}/>
          <KPI l="Tempo Médio Resposta" v="45ms" s="Vercel Edge (São Paulo)" c={C.g}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Card title="📊 Status Detalhado por Serviço" color={C.b}>
            {SERVICOS.map((sv,i)=>(
              <div key={i} style={{padding:8,marginBottom:6,background:C.bg3,borderRadius:6,borderLeft:`3px solid ${sv.cor}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:600,color:C.tx}}>{sv.nome}</span>
                  <span style={{fontSize:10,fontWeight:700,color:sv.cor}}>{sv.status.toUpperCase()}</span>
                </div>
                <div style={{display:"flex",gap:16,fontSize:9,color:C.txm}}>
                  <span>Uptime: <b style={{color:C.g}}>{sv.uptime}%</b></span>
                  <span>Latência: <b>{sv.latencia}ms</b></span>
                  <span>Último check: {sv.ultimo}</span>
                </div>
                <div style={{height:4,background:C.bd,borderRadius:2,marginTop:4}}>
                  <div style={{height:"100%",width:`${sv.uptime}%`,background:sv.cor,borderRadius:2}}/>
                </div>
              </div>
            ))}
          </Card>
          <Card title="📦 Armazenamento por Cliente" color={C.or}>
            {CLIENTES.filter(c=>c.armazenamento>0).sort((a,b)=>b.armazenamento-a.armazenamento).map((cl,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`0.5px solid ${C.bd}20`}}>
                <span style={{fontSize:10,color:C.tx}}>{cl.nome}</span>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:80,height:6,background:C.bd,borderRadius:3}}>
                    <div style={{height:"100%",width:`${cl.armazenamento/armazTotal*100}%`,background:C.or,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:9,color:C.or,fontWeight:600,width:50,textAlign:"right"}}>{cl.armazenamento} MB</span>
                </div>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",marginTop:4,borderTop:`1px solid ${C.bd}`}}>
              <span style={{fontSize:10,fontWeight:700,color:C.gol}}>TOTAL</span>
              <span style={{fontSize:10,fontWeight:700,color:C.or}}>{armazTotal} MB / 500 MB ({fP(armazTotal/500*100)})</span>
            </div>
          </Card>
        </div>
      </>)}

      {/* ═══ IA & CONSUMO ═══ */}
      {tab==="ia"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Tokens (7 dias)" v={`${(tokensTotal/1000).toFixed(0)}K`} c={C.p}/>
          <KPI l="Custo IA (7 dias)" v={`R$ ${custoIA.toFixed(2)}`} c={C.p}/>
          <KPI l="V19 Gerados" v={`${CONSUMO_IA.reduce((s,d)=>s+d.v19,0)}`} s="Últimos 7 dias" c={C.gol}/>
          <KPI l="Consultas IA" v={`${CONSUMO_IA.reduce((s,d)=>s+d.consultas,0)}`} s="Últimos 7 dias" c={C.b}/>
          <KPI l="Custo Médio/V19" v={`R$ ${(custoIA/CONSUMO_IA.reduce((s,d)=>s+d.v19,0)).toFixed(2)}`} c={C.or}/>
        </div>
        <Card title="📈 Consumo Diário de IA" color={C.p}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
              {["Dia","Tokens","Custo","V19 Gerados","Consultas IA","Custo/consulta"].map(h=>
                <th key={h} style={{padding:"6px",textAlign:h==="Dia"?"left":"right",color:C.p,fontSize:9}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {CONSUMO_IA.map((d,i)=>(
                <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}20`,background:i===CONSUMO_IA.length-1?C.p+"08":"transparent"}}>
                  <td style={{padding:"5px 6px",color:C.tx,fontWeight:i===CONSUMO_IA.length-1?700:400}}>{d.dia}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>{(d.tokens/1000).toFixed(1)}K</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.p,fontWeight:600}}>R$ {d.custo.toFixed(2)}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.gol}}>{d.v19}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.b}}>{d.consultas}</td>
                  <td style={{padding:"5px 6px",textAlign:"right",color:C.txm}}>R$ {(d.custo/(d.v19+d.consultas)).toFixed(3)}</td>
                </tr>
              ))}
              <tr style={{borderTop:`2px solid ${C.p}`,background:C.p+"10"}}>
                <td style={{padding:"6px",fontWeight:700,color:C.gol}}>TOTAL</td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:C.txm}}>{(tokensTotal/1000).toFixed(0)}K</td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:C.p}}>R$ {custoIA.toFixed(2)}</td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:C.gol}}>{CONSUMO_IA.reduce((s,d)=>s+d.v19,0)}</td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:C.b}}>{CONSUMO_IA.reduce((s,d)=>s+d.consultas,0)}</td>
                <td/>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="🔄 Retry e Erros IA" color={C.y}>
          <div style={{fontSize:10,color:C.txm,lineHeight:1.8}}>
            <b style={{color:C.y}}>Overloaded (3x):</b> Anthropic sobrecarregada — retry automático 3x resolveu todos. Nenhum dado perdido.<br/>
            <b style={{color:C.g}}>Taxa de sucesso:</b> 97.8% (146/149 requisições sem erro). 3 requisições precisaram de retry.<br/>
            <b style={{color:C.txm}}>Tempo médio resposta:</b> Consultor: 14.2s | V19: 82.5s | Classificação BPO: 3.8s
          </div>
        </Card>
      </>)}

      {/* ═══ SEGURANÇA ═══ */}
      {tab==="seguranca"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
          <KPI l="Logins (7 dias)" v={`${LOGINS_7D.reduce((s,d)=>s+d.total,0)}`} c={C.b}/>
          <KPI l="Falhas Login" v={`${LOGINS_7D.reduce((s,d)=>s+d.falhas,0)}`} s="Tentativas inválidas" c={LOGINS_7D.reduce((s,d)=>s+d.falhas,0)>10?C.r:C.y}/>
          <KPI l="Anti-Fraude" v={`${ANTIFRAUDE.boletosAnalisados} boletos`} c={C.cy}/>
          <KPI l="Fraudes Detectadas" v={`${ANTIFRAUDE.fraudesDetectadas}`} s={fR(ANTIFRAUDE.valorBloqueado)+" bloqueado"} c={C.r}/>
          <KPI l="Criptografia" v="AES-256" s="TLS 1.3 ativo" c={C.g}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Card title="🔐 Logins por Dia" color={C.b}>
            {LOGINS_7D.map((d,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`0.5px solid ${C.bd}20`}}>
                <span style={{fontSize:10,color:C.tx}}>{d.dia}</span>
                <div style={{display:"flex",gap:16}}>
                  <span style={{fontSize:10,color:C.g}}>✅ {d.total} logins</span>
                  <span style={{fontSize:10,color:d.falhas>0?C.r:C.txd}}>❌ {d.falhas} falhas</span>
                </div>
              </div>
            ))}
          </Card>
          <Card title="🛡️ Anti-Fraude de Boletos" color={C.r}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                {l:"Boletos analisados",v:`${ANTIFRAUDE.boletosAnalisados}`,c:C.b},
                {l:"Fraudes detectadas",v:`${ANTIFRAUDE.fraudesDetectadas}`,c:C.r},
                {l:"Valor bloqueado",v:fR(ANTIFRAUDE.valorBloqueado),c:C.r},
                {l:"Score médio",v:`${ANTIFRAUDE.scoreMedio}/100`,c:C.y},
              ].map((k,i)=>(
                <div key={i} style={{background:C.bg3,borderRadius:6,padding:8,borderLeft:`2px solid ${k.c}`}}>
                  <div style={{fontSize:8,color:C.txd}}>{k.l}</div>
                  <div style={{fontSize:16,fontWeight:700,color:k.c}}>{k.v}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:8,padding:8,background:C.g+"10",borderRadius:6,fontSize:9,color:C.g}}>
              ✅ R$ 148.000 em fraudes bloqueadas. ROI do módulo anti-fraude: infinito.
            </div>
          </Card>
        </div>
      </>)}

      {/* ═══ FINANCEIRO ═══ */}
      {tab==="financeiro"&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
          <KPI l="MRR (Recorrente)" v={fR(mrrTotal)} c={C.g}/>
          <KPI l="ARR Projetado" v={fR(mrrTotal*12)} c={C.g}/>
          <KPI l="Custo Infra/mês" v="R$ 306" s="Vercel+Supabase+IA" c={C.or}/>
          <KPI l="Margem Infra" v={fP((1-306/mrrTotal)*100)} c={C.g}/>
          <KPI l="LTV Médio" v={fR(mrrTotal/CLIENTES.filter(c=>c.status==="ativo"||c.status==="trial").length*24)} s="24 meses estimado" c={C.gol}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Card title="📊 Receita por Plano" color={C.g}>
            {[
              {plano:"ERP PRO",clientes:2,mrr:10000,cor:C.g},
              {plano:"BPO Escritório",clientes:1,mrr:8000,cor:C.b},
              {plano:"BPO Consultor",clientes:1,mrr:2000,cor:C.cy},
              {plano:"Wealth MFO",clientes:1,mrr:5000,cor:C.gol},
              {plano:"ERP Franquias",clientes:1,mrr:3000,cor:C.or},
              {plano:"Industrial",clientes:0,mrr:0,cor:C.p},
            ].map((p,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`0.5px solid ${C.bd}20`}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:8,height:8,borderRadius:4,background:p.cor}}/>
                  <span style={{fontSize:10,color:C.tx}}>{p.plano}</span>
                  <span style={{fontSize:8,color:C.txd}}>({p.clientes} clientes)</span>
                </div>
                <span style={{fontSize:10,fontWeight:600,color:p.cor}}>{fR(p.mrr)}/mês</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",marginTop:4,borderTop:`1px solid ${C.go}`}}>
              <span style={{fontSize:11,fontWeight:700,color:C.gol}}>TOTAL MRR</span>
              <span style={{fontSize:14,fontWeight:700,color:C.g}}>{fR(mrrTotal)}/mês</span>
            </div>
          </Card>
          <Card title="💰 Custos vs Receita" color={C.or}>
            {[
              {item:"Vercel PRO",custo:100,pct:100/mrrTotal*100},{item:"Supabase Free",custo:0,pct:0},
              {item:"Anthropic IA (estimado mês)",custo:180,pct:180/mrrTotal*100},{item:"GitHub",custo:0,pct:0},
              {item:"Domínio",custo:4,pct:4/mrrTotal*100},{item:"Certificado Digital",custo:12,pct:12/mrrTotal*100},
            ].map((c,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`0.5px solid ${C.bd}20`}}>
                <span style={{fontSize:10,color:C.txm}}>{c.item}</span>
                <span style={{fontSize:10,color:C.or}}>R$ {c.custo}/mês ({fP(c.pct)})</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",marginTop:4,borderTop:`1px solid ${C.go}`}}>
              <span style={{fontSize:11,fontWeight:700,color:C.gol}}>CUSTO TOTAL</span>
              <span style={{fontSize:11,fontWeight:700,color:C.or}}>R$ 296/mês</span>
            </div>
            <div style={{marginTop:6,padding:8,background:C.g+"10",borderRadius:6}}>
              <div style={{fontSize:10,fontWeight:700,color:C.g}}>LUCRO OPERACIONAL: {fR(mrrTotal-296)}/mês</div>
              <div style={{fontSize:9,color:C.g}}>Margem: {fP((1-296/mrrTotal)*100)} — Custo infra é {fP(296/mrrTotal*100)} da receita</div>
            </div>
          </Card>
        </div>
      </>)}

      </div>
      <div style={{textAlign:"center",padding:8,fontSize:8,color:C.txd}}>PS Gestão e Capital — Painel de Operações (NOC) v1.0 — Dados Simulados</div>
    </div>
  );
}
