"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",Y="#FACC15",R="#EF4444",
  BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",BD="#2A2822",BD2="#3D3A30",
  TX="#E8E5DC",TXM="#A8A498",TXD="#918C82",ESP="#3D2314",OW="#FAF7F2";

const fmt=(v:number)=>v>=1e6?`R$ ${(v/1e6).toFixed(2)}M`:v>=1e3?`R$ ${(v/1e3).toFixed(1)}K`:`R$ ${v.toFixed(2)}`;
const fmtP=(v:number)=>`${v>=0?"+":""}${v.toFixed(2)}%`;

interface WClient{
  id:string;nome:string;cpf_cnpj:string;tipo:string;perfil_risco:string;
  email:string;telefone:string;status:string;aporte_mensal_planejado:number;
  patrimonio_declarado:number;meta_independencia_financeira:number;
  consultor_responsavel:string;created_at:string;
}

interface Position{
  id:string;client_id:string;quantidade:number;preco_medio:number;valor_atual:number;
  asset_id:string;instituicao:string;
}

export default function WealthDashboard(){
  const [clients,setClients]=useState<WClient[]>([]);
  const [positions,setPositions]=useState<Position[]>([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState<"visao"|"clientes"|"alertas">("visao");

  const loadData=useCallback(async()=>{
    setLoading(true);
    const[{data:cl},{data:pos}]=await Promise.all([
      supabase.from("wealth_clients").select("*").order("nome"),
      supabase.from("wealth_positions").select("*"),
    ]);
    setClients(cl||[]);
    setPositions(pos||[]);
    setLoading(false);
  },[]);

  useEffect(()=>{loadData();},[loadData]);

  // KPIs computados
  const activeClients=clients.filter(c=>c.status==="ativo");
  const totalAUM=positions.reduce((s,p)=>s+(p.valor_atual||p.quantidade*p.preco_medio||0),0);
  const totalCusto=positions.reduce((s,p)=>s+(p.quantidade*p.preco_medio||0),0);
  const retornoGeral=totalCusto>0?((totalAUM/totalCusto)-1)*100:0;
  const clientesPF=clients.filter(c=>c.tipo==="PF").length;
  const clientesPJ=clients.filter(c=>c.tipo==="PJ").length;
  const prospectos=clients.filter(c=>c.status==="prospecto").length;

  // Patrimônio por cliente
  const patrimonioByClient=new Map<string,number>();
  positions.forEach(p=>{
    const v=p.valor_atual||p.quantidade*p.preco_medio||0;
    patrimonioByClient.set(p.client_id,(patrimonioByClient.get(p.client_id)||0)+v);
  });

  // Top clientes
  const topClients=activeClients.map(c=>({
    ...c,
    patrimonio:patrimonioByClient.get(c.id)||0,
  })).sort((a,b)=>b.patrimonio-a.patrimonio);

  const KPI=({label,value,detail,color}:{label:string;value:string;detail?:string;color?:string})=>(
    <div style={{background:`linear-gradient(135deg,${BG2},${BG3})`,borderRadius:12,padding:"14px 16px",borderLeft:`3px solid ${color||GO}`,border:`1px solid ${BD}`,flex:1,minWidth:140}}>
      <div style={{fontSize:10,color:TXM,letterSpacing:.8,textTransform:"uppercase",fontWeight:500}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:color||GOL,marginTop:4,letterSpacing:-.3}}>{value}</div>
      {detail&&<div style={{fontSize:11,color:TXD,marginTop:3}}>{detail}</div>}
    </div>
  );

  const Tit=({t}:{t:string})=>(
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"24px 0 12px"}}>
      <div style={{width:3,height:18,background:`linear-gradient(180deg,${GOL},${GO})`,borderRadius:2}}/>
      <span style={{fontSize:14,fontWeight:700,color:TX,letterSpacing:.2}}>{t}</span>
    </div>
  );

  if(loading) return(
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",minHeight:"60vh",color:TXM}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:24,marginBottom:8}}>📊</div>
        <div style={{fontSize:12,letterSpacing:1}}>Carregando dados...</div>
      </div>
    </div>
  );

  // Estado vazio
  if(clients.length===0) return(
    <div style={{maxWidth:600,margin:"80px auto",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>💰</div>
      <div style={{fontSize:20,fontWeight:700,color:GOL,marginBottom:8}}>PS Wealth</div>
      <div style={{fontSize:14,color:TXM,marginBottom:24}}>Módulo de Gestão Patrimonial e Investimentos</div>
      <div style={{background:BG2,borderRadius:14,padding:24,border:`1px solid ${BD}`,textAlign:"left",marginBottom:24}}>
        <div style={{fontSize:13,fontWeight:600,color:TX,marginBottom:16}}>Para começar, você precisa:</div>
        {[
          {n:1,t:"Executar a migration SQL",d:"Rode o arquivo supabase_wealth_fase1.sql no Supabase SQL Editor"},
          {n:2,t:"Cadastrar seu primeiro cliente",d:"Clique em 'Novo Cliente' para adicionar um investidor"},
          {n:3,t:"Adicionar posições",d:"Insira as posições da carteira (ações, FIIs, renda fixa)"},
        ].map(s=>(
          <div key={s.n} style={{display:"flex",gap:12,marginBottom:12}}>
            <div style={{width:28,height:28,borderRadius:8,background:`${GO}20`,border:`1px solid ${GO}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:GOL,flexShrink:0}}>{s.n}</div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:TX}}>{s.t}</div>
              <div style={{fontSize:10,color:TXD,marginTop:2}}>{s.d}</div>
            </div>
          </div>
        ))}
      </div>
      <a href="/wealth/clientes?novo=1" style={{
        display:"inline-block",padding:"12px 32px",borderRadius:10,
        background:`linear-gradient(135deg,${ESP},${GO})`,color:OW,
        fontSize:14,fontWeight:600,textDecoration:"none",letterSpacing:.3,
        boxShadow:`0 4px 16px ${GO}30`
      }}>
        + Novo Cliente
      </a>
    </div>
  );

  return(
    <div>
      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:TX}}>Painel do Escritório</div>
          <div style={{fontSize:11,color:TXD,marginTop:2}}>{activeClients.length} clientes ativos · AUM {fmt(totalAUM)}</div>
        </div>
        <a href="/wealth/clientes?novo=1" style={{
          padding:"10px 20px",borderRadius:8,background:`linear-gradient(135deg,${ESP},${GO})`,
          color:OW,fontSize:12,fontWeight:600,textDecoration:"none",letterSpacing:.3
        }}>+ Novo Cliente</a>
      </div>

      {/* KPIs */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
        <KPI label="AUM Total" value={fmt(totalAUM)} detail={`${activeClients.length} clientes ativos`}/>
        <KPI label="Retorno Geral" value={fmtP(retornoGeral)} color={retornoGeral>=0?G:R} detail="Ponderado por patrimônio"/>
        <KPI label="Clientes PF" value={String(clientesPF)} detail={`${prospectos} prospectos`}/>
        <KPI label="Clientes PJ" value={String(clientesPJ)} detail="Gestão de caixa"/>
        <KPI label="Posições" value={String(positions.length)} detail={`Em ${new Set(positions.map(p=>p.instituicao)).size} instituições`}/>
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:4,marginBottom:16}}>
        {([["visao","Visão Geral"],["clientes","Ranking Clientes"],["alertas","Alertas"]] as const).map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{
            padding:"8px 16px",borderRadius:8,border:`1px solid ${tab===id?GO+"60":BD}`,
            background:tab===id?`${GO}15`:"transparent",color:tab===id?GOL:TXM,
            fontSize:12,fontWeight:tab===id?600:400,cursor:"pointer"
          }}>{label}</button>
        ))}
      </div>

      {/* TAB: Visão Geral */}
      {tab==="visao"&&(
        <div>
          <Tit t="Distribuição por Perfil de Risco"/>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
            {["conservador","moderado","arrojado","agressivo"].map(p=>{
              const count=activeClients.filter(c=>c.perfil_risco===p).length;
              const pct=activeClients.length>0?((count/activeClients.length)*100).toFixed(0):"0";
              const colors:{[k:string]:string}={conservador:"#3B82F6",moderado:"#22C55E",arrojado:"#F59E0B",agressivo:"#EF4444"};
              return(
                <div key={p} style={{background:BG2,borderRadius:10,padding:"12px 16px",border:`1px solid ${BD}`,flex:1,minWidth:120}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:11,color:TXM,textTransform:"capitalize"}}>{p}</div>
                    <div style={{fontSize:16,fontWeight:700,color:colors[p]||TX}}>{count}</div>
                  </div>
                  <div style={{background:BD,borderRadius:4,height:4,marginTop:8,overflow:"hidden"}}>
                    <div style={{background:colors[p],height:"100%",width:`${pct}%`,borderRadius:4,transition:"width .5s"}}/>
                  </div>
                  <div style={{fontSize:9,color:TXD,marginTop:4}}>{pct}% do total</div>
                </div>
              );
            })}
          </div>

          <Tit t="Top 5 Clientes por Patrimônio"/>
          <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${BD}`}}>
                  {["Cliente","Tipo","Perfil","Patrimônio","Peso AUM"].map(h=>(
                    <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:10,color:TXD,fontWeight:500,letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topClients.slice(0,5).map((c,i)=>(
                  <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}40`,cursor:"pointer"}} onClick={()=>window.location.href=`/wealth/carteira/${c.id}`}>
                    <td style={{padding:"10px 14px"}}>
                      <div style={{fontSize:13,fontWeight:600,color:TX}}>{c.nome}</div>
                      <div style={{fontSize:10,color:TXD}}>{c.email||c.cpf_cnpj}</div>
                    </td>
                    <td style={{padding:"10px 14px"}}>
                      <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:c.tipo==="PF"?`#3B82F615`:`#8B5CF615`,color:c.tipo==="PF"?"#60A5FA":"#A78BFA",fontWeight:500}}>{c.tipo}</span>
                    </td>
                    <td style={{padding:"10px 14px",fontSize:12,color:TXM,textTransform:"capitalize"}}>{c.perfil_risco}</td>
                    <td style={{padding:"10px 14px",fontSize:13,fontWeight:600,color:GOL}}>{fmt(c.patrimonio)}</td>
                    <td style={{padding:"10px 14px",fontSize:12,color:TXM}}>{totalAUM>0?((c.patrimonio/totalAUM)*100).toFixed(1):0}%</td>
                  </tr>
                ))}
                {topClients.length===0&&(
                  <tr><td colSpan={5} style={{padding:24,textAlign:"center",color:TXD,fontSize:12}}>Nenhum cliente com posições cadastradas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Ranking Clientes */}
      {tab==="clientes"&&(
        <div>
          <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${BD}`}}>
                  {["#","Cliente","CPF/CNPJ","Perfil","Status","Patrimônio"].map(h=>(
                    <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:10,color:TXD,fontWeight:500,letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topClients.map((c,i)=>(
                  <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}40`,cursor:"pointer"}} onClick={()=>window.location.href=`/wealth/carteira/${c.id}`}>
                    <td style={{padding:"10px 14px",fontSize:12,color:TXD,fontWeight:500}}>{i+1}</td>
                    <td style={{padding:"10px 14px"}}>
                      <div style={{fontSize:13,fontWeight:600,color:TX}}>{c.nome}</div>
                      <div style={{fontSize:10,color:TXD}}>{c.email}</div>
                    </td>
                    <td style={{padding:"10px 14px",fontSize:11,color:TXM,fontFamily:"monospace"}}>{c.cpf_cnpj}</td>
                    <td style={{padding:"10px 14px",fontSize:11,color:TXM,textTransform:"capitalize"}}>{c.perfil_risco}</td>
                    <td style={{padding:"10px 14px"}}>
                      <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,
                        background:c.status==="ativo"?`${G}15`:c.status==="prospecto"?`${Y}15`:`${R}15`,
                        color:c.status==="ativo"?G:c.status==="prospecto"?Y:R,fontWeight:500
                      }}>{c.status}</span>
                    </td>
                    <td style={{padding:"10px 14px",fontSize:13,fontWeight:600,color:c.patrimonio>0?GOL:TXD}}>{c.patrimonio>0?fmt(c.patrimonio):"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Alertas */}
      {tab==="alertas"&&(
        <div>
          <div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>🛡️</div>
            <div style={{fontSize:14,fontWeight:600,color:TX}}>Compliance e Alertas</div>
            <div style={{fontSize:12,color:TXD,marginTop:4}}>Os alertas de drift, suitability e concentração serão ativados na Fase 2.</div>
            <div style={{fontSize:11,color:TXM,marginTop:12}}>Por enquanto, o sistema monitora: clientes sem IPS definido, posições sem cotação atualizada e movimentações pendentes de classificação.</div>
          </div>

          {/* Quick alerts */}
          <div style={{marginTop:16,display:"flex",gap:10,flexWrap:"wrap"}}>
            {clients.filter(c=>c.status==="ativo").length>0&&positions.length===0&&(
              <div style={{background:BG2,borderRadius:10,padding:"12px 16px",border:`1px solid ${Y}30`,borderLeft:`3px solid ${Y}`,flex:1}}>
                <div style={{fontSize:11,fontWeight:600,color:Y}}>⚠️ Clientes sem carteira</div>
                <div style={{fontSize:10,color:TXD,marginTop:4}}>{activeClients.length} clientes ativos sem posições cadastradas. Adicione posições em cada carteira.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
