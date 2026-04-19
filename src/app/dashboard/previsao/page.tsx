"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6";

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtRk=(v:any)=>{const n=Number(v)||0;if(Math.abs(n)>=1000)return`R$ ${(n/1000).toFixed(1)}k`;return`R$ ${n.toFixed(0)}`;};
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR",{day:'2-digit',month:'2-digit'}):'—';
const fmtDFull=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';

export default function PrevisaoPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [calculando,setCalculando]=useState(false);
  const [saldoInicial,setSaldoInicial]=useState(0);
  const [periodo,setPeriodo]=useState(90);
  const [realista,setRealista]=useState<any[]>([]);
  const [pessimista,setPessimista]=useState<any[]>([]);
  const [otimista,setOtimista]=useState<any[]>([]);
  const [cenarioAtivo,setCenarioAtivo]=useState<'realista'|'pessimista'|'otimista'>('realista');
  const [diaSelecionado,setDiaSelecionado]=useState<any|null>(null);
  const [msg,setMsg]=useState("");
  const [parecer,setParecer]=useState("");
  const [analisando,setAnalisando]=useState(false);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadSaldo();}},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadSaldo=async()=>{
    const{data}=await supabase.from("erp_banco_contas").select("saldo_atual").eq("company_id",sel).eq("ativo",true);
    const total=(data||[]).reduce((s,c)=>s+Number(c.saldo_atual||0),0);
    setSaldoInicial(total);
  };

  const calcularPrevisao=async()=>{
    setCalculando(true);
    setParecer("");
    try{
      const[{data:r},{data:p},{data:o}]=await Promise.all([
        supabase.rpc('gerar_previsao_fluxo_caixa',{p_company_id:sel,p_dias:periodo,p_cenario:'realista'}),
        supabase.rpc('gerar_previsao_fluxo_caixa',{p_company_id:sel,p_dias:periodo,p_cenario:'pessimista'}),
        supabase.rpc('gerar_previsao_fluxo_caixa',{p_company_id:sel,p_dias:periodo,p_cenario:'otimista'}),
      ]);
      setRealista(r||[]);
      setPessimista(p||[]);
      setOtimista(o||[]);
      setMsg(`✅ Previsão calculada para ${periodo} dias`);
    }catch(e:any){setMsg("❌ "+e.message);}
    setCalculando(false);
    setTimeout(()=>setMsg(""),3000);
  };

  const cenarioDados=cenarioAtivo==='pessimista'?pessimista:cenarioAtivo==='otimista'?otimista:realista;

  // Alertas de saldo negativo
  const alertas=useMemo(()=>{
    const a:any[]=[];
    cenarioDados.forEach((d:any,idx:number)=>{
      const saldoAnt=idx>0?Number(cenarioDados[idx-1].saldo_acumulado):saldoInicial;
      const saldoAtual=Number(d.saldo_acumulado);
      if(saldoAtual<0&&saldoAnt>=0){
        a.push({tipo:'critico',data:d.data,valor:saldoAtual,mensagem:`Saldo fica NEGATIVO em ${fmtR(Math.abs(saldoAtual))}`});
      }
    });
    return a;
  },[cenarioDados,saldoInicial]);

  const stats=useMemo(()=>{
    if(cenarioDados.length===0)return null;
    const totalEnt=cenarioDados.reduce((s:number,d:any)=>s+Number(d.entrada_provavel||0),0);
    const totalSai=cenarioDados.reduce((s:number,d:any)=>s+Number(d.saida_certa||0)+Number(d.saida_recorrente||0),0);
    const saldoFinal=Number(cenarioDados[cenarioDados.length-1].saldo_acumulado);
    const menorSaldo=Math.min(...cenarioDados.map((d:any)=>Number(d.saldo_acumulado)));
    const diasNeg=cenarioDados.filter((d:any)=>Number(d.saldo_acumulado)<0).length;
    return{totalEnt,totalSai,saldoFinal,menorSaldo,diasNeg,resultado:totalEnt-totalSai};
  },[cenarioDados]);

  const analisarComIA=async()=>{
    setAnalisando(true);
    setParecer("");
    try{
      const r=await fetch("/api/previsao-fluxo-ia",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          company_id:sel,
          projecao:cenarioDados,
          saldo_inicial:saldoInicial,
          alertas,
          periodo_dias:periodo,
        }),
      });
      const d=await r.json();
      if(d.error)setMsg("❌ "+d.error);
      else setParecer(d.parecer);
    }catch(e:any){setMsg("❌ "+e.message);}
    setAnalisando(false);
  };

  // Gráfico SVG
  const grafico=useMemo(()=>{
    if(realista.length===0)return null;
    const W=1000,H=260,PAD_L=60,PAD_R=20,PAD_T=20,PAD_B=40;
    const plotW=W-PAD_L-PAD_R,plotH=H-PAD_T-PAD_B;
    
    // Range Y
    const allSaldos=[saldoInicial,...realista.map((d:any)=>Number(d.saldo_acumulado)),...pessimista.map((d:any)=>Number(d.saldo_acumulado)),...otimista.map((d:any)=>Number(d.saldo_acumulado))];
    const yMin=Math.min(0,...allSaldos);
    const yMax=Math.max(...allSaldos);
    const range=yMax-yMin||1;
    
    const xAt=(i:number)=>PAD_L+(plotW*i)/Math.max(realista.length-1,1);
    const yAt=(v:number)=>PAD_T+plotH-((v-yMin)/range)*plotH;
    const y0=yAt(0);
    
    const pathRealista=realista.map((d:any,i:number)=>`${i===0?'M':'L'}${xAt(i)},${yAt(Number(d.saldo_acumulado))}`).join(' ');
    const pathPessimista=pessimista.map((d:any,i:number)=>`${i===0?'M':'L'}${xAt(i)},${yAt(Number(d.saldo_acumulado))}`).join(' ');
    const pathOtimista=otimista.map((d:any,i:number)=>`${i===0?'M':'L'}${xAt(i)},${yAt(Number(d.saldo_acumulado))}`).join(' ');
    
    // Ticks Y
    const ticks=5;
    const ticksY=Array.from({length:ticks+1},(_,i)=>yMin+(range*i)/ticks);
    
    return(
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",background:BG3,borderRadius:8}}>
        {/* Grade */}
        {ticksY.map((v,i)=>(
          <g key={i}>
            <line x1={PAD_L} y1={yAt(v)} x2={W-PAD_R} y2={yAt(v)} stroke={BD} strokeWidth={0.5} strokeDasharray={v===0?"":"2 4"}/>
            <text x={PAD_L-8} y={yAt(v)+3} fontSize={9} fill={TXD} textAnchor="end">{fmtRk(v)}</text>
          </g>
        ))}
        {/* Linha zero destacada */}
        <line x1={PAD_L} y1={y0} x2={W-PAD_R} y2={y0} stroke={R} strokeWidth={1} opacity={0.5}/>
        
        {/* Paths */}
        <path d={pathPessimista} fill="none" stroke={R} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6}/>
        <path d={pathOtimista} fill="none" stroke={G} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6}/>
        <path d={pathRealista} fill="none" stroke={GO} strokeWidth={2.5}/>
        
        {/* Ponto inicial */}
        <circle cx={PAD_L} cy={yAt(saldoInicial)} r={4} fill={B}/>
        
        {/* Labels X (primeiro, meio, último) */}
        {[0,Math.floor(realista.length/2),realista.length-1].map((i,k)=>(
          <text key={k} x={xAt(i)} y={H-PAD_B+15} fontSize={9} fill={TXD} textAnchor="middle">{fmtD(realista[i]?.data)}</text>
        ))}
        
        {/* Legenda */}
        <g transform={`translate(${PAD_L+10},${PAD_T+5})`}>
          <rect x={0} y={0} width={200} height={50} fill={BG2} rx={4} opacity={0.9}/>
          <line x1={8} y1={12} x2={22} y2={12} stroke={GO} strokeWidth={2.5}/><text x={28} y={15} fontSize={9} fill={TX}>Realista</text>
          <line x1={8} y1={26} x2={22} y2={26} stroke={G} strokeWidth={1.5} strokeDasharray="3 3"/><text x={28} y={29} fontSize={9} fill={TX}>Otimista (+10%/-5%)</text>
          <line x1={8} y1={40} x2={22} y2={40} stroke={R} strokeWidth={1.5} strokeDasharray="3 3"/><text x={28} y={43} fontSize={9} fill={TX}>Pessimista (-20%/+5%)</text>
        </g>
      </svg>
    );
  },[realista,pessimista,otimista,saldoInicial]);

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>📈 Previsão de Fluxo de Caixa</div>
          <div style={{fontSize:11,color:TXD}}>Projeção 90 dias · Score ponderado · 3 cenários · Parecer IA</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);setRealista([]);setPessimista([]);setOtimista([]);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <select value={periodo} onChange={e=>setPeriodo(parseInt(e.target.value))} style={selSt}>
            <option value={30}>30 dias</option>
            <option value={60}>60 dias</option>
            <option value={90}>90 dias</option>
            <option value={120}>120 dias</option>
          </select>
          <button onClick={calcularPrevisao} disabled={calculando} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:calculando?"wait":"pointer",opacity:calculando?0.5:1}}>
            {calculando?"⏳ Calculando...":"📊 Calcular Previsão"}
          </button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* Saldo inicial destacado */}
      <div style={{background:B+"10",borderRadius:10,padding:"12px 16px",marginBottom:16,border:`1px solid ${B}40`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:10,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>💼 Saldo Inicial (soma contas bancárias ativas)</div>
          <div style={{fontSize:22,fontWeight:800,color:saldoInicial>=0?B:R,fontFamily:"monospace"}}>{fmtR(saldoInicial)}</div>
        </div>
        <div style={{fontSize:10,color:TXD,textAlign:"right"}}>Clique em "Calcular Previsão" pra ver a projeção dos próximos {periodo} dias</div>
      </div>

      {realista.length>0&&(
        <>
          {/* Toggle de cenários */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {[{k:'realista',l:'📊 Realista',c:GO},{k:'pessimista',l:'⚠️ Pessimista',c:R},{k:'otimista',l:'✨ Otimista',c:G}].map(c=>(
              <button key={c.k} onClick={()=>setCenarioAtivo(c.k as any)} style={{padding:"8px 16px",borderRadius:8,fontSize:11,fontWeight:600,border:`2px solid ${cenarioAtivo===c.k?c.c:BD}`,background:cenarioAtivo===c.k?c.c+"15":"transparent",color:cenarioAtivo===c.k?c.c:TXM,cursor:"pointer"}}>{c.l}</button>
            ))}
          </div>

          {/* Stats do cenário */}
          {stats&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
              {[
                {l:"Entradas",v:fmtR(stats.totalEnt),c:G,icon:"💰"},
                {l:"Saídas",v:fmtR(stats.totalSai),c:R,icon:"💸"},
                {l:"Resultado",v:fmtR(stats.resultado),c:stats.resultado>=0?G:R,icon:"📊"},
                {l:"Saldo Final",v:fmtR(stats.saldoFinal),c:stats.saldoFinal>=0?G:R,icon:"💼"},
                {l:"Menor Saldo",v:fmtR(stats.menorSaldo),c:stats.menorSaldo>=0?G:R,icon:stats.menorSaldo>=0?"✅":"⚠️"},
              ].map((k,i)=>(
                <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
                  <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
                  <div style={{fontSize:14,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Alertas */}
          {alertas.length>0&&(
            <div style={{background:R+"10",borderRadius:10,padding:14,marginBottom:16,border:`2px solid ${R}40`}}>
              <div style={{fontSize:13,fontWeight:700,color:R,marginBottom:8}}>⚠️ Alertas Críticos</div>
              {alertas.map((a:any,i:number)=>(
                <div key={i} style={{fontSize:11,color:R,padding:"4px 0",borderBottom:i<alertas.length-1?`1px solid ${R}20`:"none"}}>
                  <b>{fmtDFull(a.data)}:</b> {a.mensagem}
                </div>
              ))}
            </div>
          )}

          {/* Gráfico */}
          <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:12,fontWeight:600,color:GO,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>📈 Evolução do Saldo</div>
            {grafico}
          </div>

          {/* Parecer IA */}
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:700,color:GO,textTransform:"uppercase",letterSpacing:0.5}}>🤖 Análise Estratégica com IA (Claude)</div>
              {!parecer&&<button onClick={analisarComIA} disabled={analisando} style={{padding:"8px 16px",borderRadius:8,background:P+"15",color:P,fontSize:11,fontWeight:600,border:`1px solid ${P}40`,cursor:analisando?"wait":"pointer",opacity:analisando?0.5:1}}>{analisando?"⏳ Analisando...":"🧠 Analisar com IA"}</button>}
            </div>
            {parecer?(
              <div style={{background:P+"08",borderRadius:10,padding:16,border:`1px solid ${P}30`}}>
                <div style={{whiteSpace:"pre-wrap",fontSize:12,color:TX,lineHeight:1.6}}>{parecer}</div>
              </div>
            ):(
              <div style={{background:BG3,borderRadius:10,padding:16,textAlign:"center",color:TXD,fontSize:11}}>
                Clique em "Analisar com IA" para gerar um parecer estratégico sobre o fluxo de caixa projetado (diagnóstico, pontos críticos, ações imediatas, oportunidades).
              </div>
            )}
          </div>

          {/* Tabela resumo */}
          <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto",maxHeight:400}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{position:"sticky",top:0,background:BG3,zIndex:1}}>
                <tr style={{borderBottom:`2px solid ${BD}`}}>
                  <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:80}}>Data</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:120}}>Entradas</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:120}}>Saídas</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:120}}>Saldo Dia</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:130}}>Saldo Acumulado</th>
                  <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:60}}>Eventos</th>
                </tr>
              </thead>
              <tbody>
                {cenarioDados.map((d:any,i:number)=>{
                  const totalSaida=Number(d.saida_certa||0)+Number(d.saida_recorrente||0);
                  const negativo=Number(d.saldo_acumulado)<0;
                  const eventos=Array.isArray(d.eventos)?d.eventos:[];
                  return(
                    <tr key={i} style={{borderBottom:`0.5px solid ${BD}`,background:negativo?R+"06":"transparent",cursor:eventos.length>0?"pointer":"default"}} onClick={()=>eventos.length>0&&setDiaSelecionado(d)}>
                      <td style={{padding:"6px 8px",textAlign:"center",color:TXM,fontFamily:"monospace"}}>{fmtD(d.data)}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:Number(d.entrada_provavel)>0?G:TXD,fontWeight:Number(d.entrada_provavel)>0?600:400}}>{Number(d.entrada_provavel)>0?fmtR(d.entrada_provavel):'—'}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:totalSaida>0?R:TXD,fontWeight:totalSaida>0?600:400}}>{totalSaida>0?fmtR(totalSaida):'—'}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:Number(d.saldo_dia)>=0?G:R,fontWeight:600}}>{fmtR(d.saldo_dia)}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:negativo?R:TX,fontFamily:"monospace"}}>{fmtR(d.saldo_acumulado)}</td>
                      <td style={{padding:"6px 8px",textAlign:"center"}}>{eventos.length>0?<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:B+"15",color:B,fontWeight:600}}>{eventos.length}</span>:'—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {realista.length===0&&!calculando&&(
        <div style={{background:BG2,borderRadius:12,padding:60,textAlign:"center",border:`1px dashed ${BD}`}}>
          <div style={{fontSize:48,marginBottom:12}}>📈</div>
          <div style={{fontSize:16,fontWeight:600,color:TX,marginBottom:6}}>Previsão de Fluxo de Caixa</div>
          <div style={{fontSize:12,color:TXD,maxWidth:500,margin:"0 auto 16px"}}>Com base em títulos em aberto, score dos clientes, recorrências detectadas automaticamente e histórico de 12 meses, projetamos o saldo dia-a-dia dos próximos {periodo} dias em 3 cenários simultâneos.</div>
          <button onClick={calcularPrevisao} style={{padding:"12px 24px",borderRadius:8,background:GO,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>📊 Calcular Agora</button>
        </div>
      )}

      {/* Modal Eventos do Dia */}
      {diaSelecionado&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setDiaSelecionado(null)}>
          <div style={{background:BG2,borderRadius:16,padding:20,maxWidth:700,width:"100%",maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>📅 {fmtDFull(diaSelecionado.data)}</div>
                <div style={{fontSize:11,color:TXD}}>{(diaSelecionado.eventos||[]).length} evento(s) esperado(s) neste dia</div>
              </div>
              <button onClick={()=>setDiaSelecionado(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {(diaSelecionado.eventos||[]).map((e:any,i:number)=>(
                <div key={i} style={{background:BG3,borderRadius:8,padding:10,borderLeft:`3px solid ${e.tipo==='receita'?G:R}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                    <div style={{fontSize:11,fontWeight:600,color:e.tipo==='receita'?G:R}}>{e.tipo==='receita'?'💰 RECEBER':'💸 PAGAR'} {fmtR(e.valor)}</div>
                    {e.probabilidade&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:e.probabilidade>=90?G+"20":e.probabilidade>=70?Y+"20":R+"20",color:e.probabilidade>=90?G:e.probabilidade>=70?Y:R,fontWeight:600}}>{e.probabilidade}% prob</span>}
                  </div>
                  <div style={{fontSize:11,color:TX}}>{e.descricao}</div>
                  {e.cliente&&<div style={{fontSize:9,color:TXD,marginTop:2}}>{e.cliente}{e.score!=null&&` · Score ${e.score}`}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Previsão de Fluxo v1.0 · Score ponderado · Parecer IA · Sprint 5.1</div>
    </div>
  );
}
