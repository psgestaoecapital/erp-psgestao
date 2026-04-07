"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",G="#34D399",R="#F87171",Y="#FBBF24",
    BG2="#161614",BG3="#1E1E1B",BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#6B6960";

const fmt=(v:number)=>v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtR=(v:number)=>`R$ ${fmt(v)}`;

type Flag = { tipo:"critical"|"attention"|"opportunity"; titulo:string; analise:string; acao:string; impacto:string; };

function gerarFlags(dados:any, contexto:string, periodo:string): Flag[] {
  const flags: Flag[] = [];
  if(!dados) return flags;
  const totalRec=dados.total_receitas||dados.total_rec_operacional||0;
  const totalDesp=dados.total_despesas||0;
  const resultado=dados.resultado_periodo||(totalRec-totalDesp);
  const margem=totalRec>0?(resultado/totalRec*100):0;
  const dre=dados.dre_mensal||[];
  const last=dre.length>0?dre[dre.length-1]:null;
  const prev=dre.length>1?dre[dre.length-2]:null;
  const grupos=dados.grupos_custo||[];
  const topCusto=grupos.length>0?grupos[0]:null;

  if(resultado<0){
    flags.push({tipo:"critical",titulo:`Resultado Negativo: ${fmtR(resultado)}`,
      analise:`No período ${periodo}, a empresa gastou mais do que faturou. Receitas: ${fmtR(totalRec)} vs. Despesas: ${fmtR(totalDesp)}. Margem: ${margem.toFixed(1)}%.${contexto?" Contexto da empresa deve ser considerado na análise das causas.":""}`,
      acao:"1) Identificar os 3 maiores centros de custo e buscar redução imediata de 10%. 2) Revisar política de preços. 3) Congelar contratações e gastos não essenciais.",
      impacto:`Para zerar o prejuízo, é necessário aumentar receita em ${fmtR(Math.abs(resultado))} ou cortar custos no mesmo valor.`});
  }
  if(margem>0&&margem<5&&totalRec>50000){
    flags.push({tipo:"critical",titulo:`Margem Muito Baixa: ${margem.toFixed(1)}%`,
      analise:`A operação gera lucro mínimo no período ${periodo}. Qualquer aumento de custo pode inverter o resultado.`,
      acao:`Revisar os 10 maiores itens de custo. Renegociar com fornecedores que representam mais de 5% do custo total. ${contexto.includes("energia")?"O custo de energia mencionado no contexto deve ser priorizado.":""}`,
      impacto:`Meta: margem de 10% em 90 dias = +${fmtR(totalRec*0.05)} de resultado adicional.`});
  }
  if(topCusto&&topCusto.total>totalDesp*0.3){
    flags.push({tipo:"critical",titulo:`Concentração de Custos: ${topCusto.nome}`,
      analise:`O grupo "${topCusto.nome}" representa ${(topCusto.total/totalDesp*100).toFixed(0)}% do total de despesas (${fmtR(topCusto.total)} de ${fmtR(totalDesp)}).`,
      acao:`Detalhar as ${topCusto.contas?.length||0} contas deste grupo. Identificar quais cresceram acima da inflação. ${contexto.includes("rotatividade")?"A rotatividade mencionada no contexto pode estar inflando custos.":"Negociar contratos de maior valor."}`,
      impacto:`Redução de 10% neste grupo = economia de ${fmtR(topCusto.total*0.1)} no período.`});
  }
  if(last&&prev){
    const recAt=Number(last.receita)||0;const recAnt=Number(prev.receita)||0;
    if(recAnt>0&&recAt<recAnt*0.9){
      flags.push({tipo:"attention",titulo:`Receita Caiu ${((1-recAt/recAnt)*100).toFixed(1)}% no Último Mês`,
        analise:`Receita passou de ${fmtR(recAnt)} para ${fmtR(recAt)}. ${contexto.toLowerCase().includes("sazonalidade")?"Verificar se a queda é sazonal conforme indicado no contexto.":"Investigar causa."}`,
        acao:"Contatar os 10 maiores clientes para entender se há insatisfação. Verificar se concorrentes lançaram promoção.",
        impacto:`Recuperar o nível anterior significaria +${fmtR(recAnt-recAt)}/mês.`});
    }
    if(recAnt>0&&recAt>recAnt*1.1){
      flags.push({tipo:"opportunity",titulo:`Receita em Crescimento: +${((recAt/recAnt-1)*100).toFixed(0)}%`,
        analise:`Receita cresceu de ${fmtR(recAnt)} para ${fmtR(recAt)} no último mês. ${contexto.toLowerCase().includes("crescimento")?"Confirma a tendência de crescimento mencionada no contexto.":"Momentum positivo."}`,
        acao:"Aproveitar o momento: reforçar equipe comercial, negociar melhores condições com fornecedores.",
        impacto:`Se mantido o ritmo, projeção de receita anual: ${fmtR(recAt*12)}.`});
    }
  }
  if(dre.length>=3){
    const first=dre[0];const last2=dre[dre.length-1];
    const recG=first.receita>0?((last2.receita||0)/first.receita-1):0;
    const despG=first.receita>0&&first.lucro_final!==undefined?(((last2.receita||0)-(last2.lucro_final||0))/((first.receita||0)-(first.lucro_final||0))-1):0;
    if(despG>recG+0.05&&despG>0.1){
      flags.push({tipo:"attention",titulo:"Custos Crescem Mais Rápido que Receita",
        analise:`No período ${periodo}, os custos cresceram ${(despG*100).toFixed(0)}% enquanto a receita cresceu ${(recG*100).toFixed(0)}%.`,
        acao:"Revisar cada grupo de custo no Mapa e identificar quais subiram acima da média.",
        impacto:`Equalizar o crescimento preservaria ${fmtR(totalRec*Math.abs(despG-recG)*0.5)} de margem.`});
    }
  }
  const gruposAltos=grupos.filter((g:any)=>g.total>totalDesp*0.15);
  if(gruposAltos.length>=3){
    flags.push({tipo:"attention",titulo:`${gruposAltos.length} Grupos de Custo Significativos`,
      analise:`Há ${gruposAltos.length} grupos que individualmente representam mais de 15% das despesas: ${gruposAltos.map((g:any)=>g.nome).join(", ")}.`,
      acao:"Para cada grupo, definir um responsável e uma meta de redução de 5% em 60 dias.",
      impacto:`Redução de 5% = economia total de ${fmtR(gruposAltos.reduce((s:number,g:any)=>s+g.total,0)*0.05)}.`});
  }
  if(margem>10){
    flags.push({tipo:"opportunity",titulo:`Margem Saudável de ${margem.toFixed(1)}% — Potencial de Investimento`,
      analise:`Com margem acima de 10%, a empresa tem espaço para investir em crescimento. Resultado de ${fmtR(resultado)} no período.`,
      acao:"Avaliar: 1) Investimento em marketing (ROI 3x). 2) Automação de processos. 3) Capacitação da equipe.",
      impacto:`Reinvestir 20% do resultado (${fmtR(resultado*0.2)}) pode gerar crescimento de 15-20%.`});
  }
  if(contexto.includes("exportação")||contexto.includes("internacional")){
    flags.push({tipo:"opportunity",titulo:"Potencial de Expansão Internacional",
      analise:"O contexto indica operação internacional. Com câmbio favorável, há oportunidade de aumentar exportação.",
      acao:"Prospectar novos mercados via APEX Brasil. Avaliar certificações adicionais para mercados premium.",
      impacto:"Cada 10% a mais de exportação pode agregar 2-3pp de margem adicional."});
  }
  if(contexto.includes("OEE")||contexto.includes("oee")){
    flags.push({tipo:"opportunity",titulo:"Ganho de Eficiência Industrial (OEE)",
      analise:"O contexto menciona indicador OEE com meta acima do atual. Cada ponto de OEE representa ganho direto.",
      acao:"Implementar programa de melhoria contínua com metas semanais de OEE.",
      impacto:`Cada 1pp de OEE equivale a aproximadamente ${fmtR(totalRec*0.004)} de margem adicional/período.`});
  }
  return flags;
}

const FC={critical:{bg:"#F8717110",border:"#F8717135",accent:R,label:"CRÍTICO"},attention:{bg:"#FBBF2410",border:"#FBBF2430",accent:Y,label:"ATENÇÃO"},opportunity:{bg:"#34D39910",border:"#34D39930",accent:G,label:"OPORTUNIDADE"}};

export default function AnaliseIAFlags({realData,empresaId,periodo}:{realData:any;empresaId:string;periodo:string}){
  const[contexto,setContexto]=useState("");
  const[flags,setFlags]=useState<Flag[]>([]);
  const[expanded,setExpanded]=useState<Record<number,boolean>>({});
  const[loading,setLoading]=useState(true);

  useEffect(()=>{
    const load=async()=>{setLoading(true);try{
      const{data}=await supabase.from("ai_reports").select("report_content").eq("report_type","contexto_humano").order("created_at",{ascending:false}).limit(1).single();
      if(data?.report_content){setContexto(typeof data.report_content==="string"?data.report_content:JSON.stringify(data.report_content));}
    }catch{}setLoading(false);};load();
  },[empresaId]);

  useEffect(()=>{if(!loading){setFlags(gerarFlags(realData,contexto,periodo));setExpanded({});}
  },[realData,contexto,periodo,loading]);

  if(!realData||flags.length===0)return null;
  const counts={critical:flags.filter(f=>f.tipo==="critical").length,attention:flags.filter(f=>f.tipo==="attention").length,opportunity:flags.filter(f=>f.tipo==="opportunity").length};

  return(
    <div style={{marginTop:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:6,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#0C0C0A"}}>PS</div>
          <div><div style={{fontSize:13,fontWeight:700,color:GOL}}>Análise IA — Consultor Digital</div>
          <div style={{fontSize:9,color:TXD}}>DRE + Custos + Contexto · {periodo}</div></div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {counts.critical>0&&<span style={{padding:"2px 8px",borderRadius:6,fontSize:12,fontWeight:700,color:R,background:"#F8717115",border:"1px solid #F8717130"}}>🔴 {counts.critical}</span>}
          {counts.attention>0&&<span style={{padding:"2px 8px",borderRadius:6,fontSize:12,fontWeight:700,color:Y,background:"#FBBF2415",border:"1px solid #FBBF2430"}}>🟡 {counts.attention}</span>}
          {counts.opportunity>0&&<span style={{padding:"2px 8px",borderRadius:6,fontSize:12,fontWeight:700,color:G,background:"#34D39915",border:"1px solid #34D39930"}}>🟢 {counts.opportunity}</span>}
        </div>
      </div>
      {flags.map((flag,i)=>{const c=FC[flag.tipo];const isOpen=!!expanded[i];return(
        <div key={i} style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:10,marginBottom:6,overflow:"hidden",borderLeft:`3px solid ${c.accent}`}}>
          <div onClick={()=>setExpanded(prev=>({...prev,[i]:!prev[i]}))} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"flex-start",gap:10}}>
            <span style={{fontSize:16,flexShrink:0}}>{flag.tipo==="critical"?"🔴":flag.tipo==="attention"?"🟡":"🟢"}</span>
            <div style={{flex:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,marginBottom:3}}>
                <span style={{fontSize:12,fontWeight:600,color:TX}}>{flag.titulo}</span>
                <span style={{fontSize:8,fontWeight:700,letterSpacing:1,padding:"1px 6px",borderRadius:4,background:`${c.accent}20`,color:c.accent}}>{c.label}</span>
              </div>
              <div style={{fontSize:11,color:TXM,lineHeight:1.5}}>{flag.analise}</div>
            </div>
            <span style={{color:TXD,fontSize:14,flexShrink:0,transition:"transform 0.3s",transform:isOpen?"rotate(180deg)":""}}>▾</span>
          </div>
          {isOpen&&(<div style={{borderTop:`1px solid ${c.border}`,padding:"10px 14px 10px 40px"}}>
            <div style={{marginBottom:10}}><div style={{fontSize:9,fontWeight:700,color:c.accent,letterSpacing:1,marginBottom:4}}>▸ AÇÃO RECOMENDADA</div>
            <div style={{fontSize:11,color:TX,lineHeight:1.6,background:"#00000030",padding:"8px 10px",borderRadius:6}}>{flag.acao}</div></div>
            <div><div style={{fontSize:9,fontWeight:700,color:c.accent,letterSpacing:1,marginBottom:4}}>▸ IMPACTO ESTIMADO</div>
            <div style={{fontSize:11,color:TX,lineHeight:1.5}}>{flag.impacto}</div></div>
          </div>)}
        </div>);
      })}
      <div style={{fontSize:8,color:TXD,textAlign:"right",marginTop:6}}>Análise automática · {flags.length} alertas · {new Date().toLocaleDateString("pt-BR")} {new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>
    </div>
  );
}
