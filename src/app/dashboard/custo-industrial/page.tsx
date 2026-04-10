"use client";
import React, { useState } from "react";
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",ow:"#FAF7F2",g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",pk:"#EC4899",bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};
const fR=(v:number)=>v<0?`(${Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})})`:`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fP=(v:number)=>`${v.toFixed(2)}%`;
const fN=(v:number)=>v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const PIS_COF={cum:{pis:0.65,cof:3.0},ncum:{pis:1.65,cof:7.6}};
const REFORMA={cbs:8.8,ibs:17.7,trans:[{a:2026,c:0,i:0,n:"Atual 100%"},{a:2027,c:10,i:0,n:"CBS teste 10%"},{a:2029,c:100,i:10,n:"CBS 100%+IBS 10%"},{a:2031,c:100,i:30,n:"IBS 30%"},{a:2033,c:100,i:100,n:"IBS 100% ICMS extinto"}]};
const PRODS:any[]=[
  {id:"P01",nome:"Linguiça Calabresa 1kg",ncm:"16010000",cest:"1700600",cfop:"5101",cst:"000",un:"KG",
   mp:[{it:"Carne suína (pernil)",q:0.55,u:"kg",c:14.80,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02031900"},{it:"Toucinho",q:0.15,u:"kg",c:8.20,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02031900"},{it:"Sal refinado",q:0.018,u:"kg",c:2.50,ic:18,pi:1.65,co:7.6,ip:0,ncm:"25010019"},{it:"Pimenta calabresa",q:0.005,u:"kg",c:85.00,ic:12,pi:1.65,co:7.6,ip:0,ncm:"09042190"},{it:"Alho desidratado",q:0.003,u:"kg",c:62.00,ic:12,pi:1.65,co:7.6,ip:0,ncm:"07129090"},{it:"Eritorbato sódio",q:0.0005,u:"kg",c:120.00,ic:18,pi:1.65,co:7.6,ip:0,ncm:"29329990"},{it:"Nitrito sódio",q:0.00015,u:"kg",c:95.00,ic:18,pi:1.65,co:7.6,ip:0,ncm:"28341010"},{it:"Tripa natural",q:0.8,u:"m",c:2.50,ic:12,pi:1.65,co:7.6,ip:0,ncm:"05040000"},{it:"Embalagem vácuo",q:1,u:"un",c:0.85,ic:18,pi:1.65,co:7.6,ip:5,ncm:"39232190"},{it:"Rótulo",q:1,u:"un",c:0.12,ic:18,pi:1.65,co:7.6,ip:0,ncm:"48211090"},{it:"Caixa papelão",q:0.1,u:"un",c:3.20,ic:18,pi:1.65,co:7.6,ip:5,ncm:"48191000"}],
   mod:{h:0.012,sal:18.50,inss:28.8,f13:8.33,fer:11.11,fgts:8,ins:20,out:5},
   gif:{ener:0.42,agua:0.08,vapor:0.15,manP:0.10,manC:0.05,depM:0.18,depP:0.04,limp:0.10,lab:0.05,epi:0.03,seg:0.02,alv:0.01},
   adm:{adm:0.35,ti:0.05,cont:0.08,jur:0.02},com:{comis:3,frete:4,mkt:0.5,dev:0.8},fin:{antec:1.2,inad:0.5},
   fisc:{icS:12,ipi:0,csll:1.08,irpj:1.20},preco:24.90,vol:45000},
  {id:"P02",nome:"Salsicha Hot Dog 3kg",ncm:"16010000",cest:"1700600",cfop:"5101",cst:"000",un:"KG",
   mp:[{it:"CMS suína",q:0.45,u:"kg",c:6.80,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02031900"},{it:"Carne paleta",q:0.20,u:"kg",c:12.50,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02031900"},{it:"Amido mandioca",q:0.08,u:"kg",c:4.20,ic:18,pi:1.65,co:7.6,ip:0,ncm:"11081400"},{it:"Água/gelo",q:0.15,u:"kg",c:0.10,ic:0,pi:0,co:0,ip:0,ncm:"22011000"},{it:"Proteína soja",q:0.03,u:"kg",c:12.00,ic:12,pi:1.65,co:7.6,ip:0,ncm:"21061000"},{it:"Condimentos",q:0.02,u:"kg",c:35.00,ic:18,pi:1.65,co:7.6,ip:0,ncm:"09109190"},{it:"Tripa celulósica",q:1.2,u:"m",c:0.45,ic:18,pi:1.65,co:7.6,ip:0,ncm:"39199090"},{it:"Embalagem 3kg",q:0.33,u:"un",c:1.20,ic:18,pi:1.65,co:7.6,ip:5,ncm:"39232190"}],
   mod:{h:0.008,sal:17.00,inss:28.8,f13:8.33,fer:11.11,fgts:8,ins:20,out:5},
   gif:{ener:0.38,agua:0.12,vapor:0.12,manP:0.08,manC:0.04,depM:0.15,depP:0.03,limp:0.08,lab:0.04,epi:0.02,seg:0.02,alv:0.01},
   adm:{adm:0.30,ti:0.04,cont:0.06,jur:0.02},com:{comis:3,frete:4,mkt:0.5,dev:1.0},fin:{antec:1.2,inad:0.5},
   fisc:{icS:12,ipi:0,csll:1.08,irpj:1.20},preco:14.50,vol:82000},
  {id:"P03",nome:"Presunto Cozido 200g",ncm:"16024900",cest:"1700600",cfop:"5101",cst:"000",un:"KG",
   mp:[{it:"Carne pernil",q:0.65,u:"kg",c:14.80,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02031900"},{it:"Amido/proteína",q:0.10,u:"kg",c:8.50,ic:18,pi:1.65,co:7.6,ip:0,ncm:"11081400"},{it:"Água/salmoura",q:0.18,u:"kg",c:0.50,ic:0,pi:0,co:0,ip:0,ncm:"22011000"},{it:"Condimentos",q:0.015,u:"kg",c:45.00,ic:18,pi:1.65,co:7.6,ip:0,ncm:"09109190"},{it:"Embalagem vácuo",q:5,u:"un",c:0.35,ic:18,pi:1.65,co:7.6,ip:5,ncm:"39232190"},{it:"Caixa master",q:0.05,u:"un",c:4.50,ic:18,pi:1.65,co:7.6,ip:5,ncm:"48191000"}],
   mod:{h:0.018,sal:20.00,inss:28.8,f13:8.33,fer:11.11,fgts:8,ins:20,out:5},
   gif:{ener:0.55,agua:0.10,vapor:0.18,manP:0.12,manC:0.06,depM:0.22,depP:0.06,limp:0.12,lab:0.06,epi:0.03,seg:0.02,alv:0.01},
   adm:{adm:0.40,ti:0.06,cont:0.10,jur:0.03},com:{comis:3,frete:4,mkt:0.5,dev:0.5},fin:{antec:1.2,inad:0.3},
   fisc:{icS:12,ipi:0,csll:1.08,irpj:1.20},preco:38.90,vol:18000},
  {id:"P04",nome:"Mortadela Bologna 500g",ncm:"16010000",cest:"1700600",cfop:"5101",cst:"000",un:"KG",
   mp:[{it:"CMS suína",q:0.40,u:"kg",c:6.80,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02031900"},{it:"Carne bovina",q:0.15,u:"kg",c:18.50,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02013000"},{it:"Toucinho",q:0.15,u:"kg",c:8.20,ic:12,pi:1.65,co:7.6,ip:0,ncm:"02031900"},{it:"Amido",q:0.10,u:"kg",c:4.20,ic:18,pi:1.65,co:7.6,ip:0,ncm:"11081400"},{it:"Água/gelo",q:0.12,u:"kg",c:0.10,ic:0,pi:0,co:0,ip:0,ncm:"22011000"},{it:"Condimentos",q:0.02,u:"kg",c:38.00,ic:18,pi:1.65,co:7.6,ip:0,ncm:"09109190"},{it:"Embalagem 500g",q:2,u:"un",c:0.42,ic:18,pi:1.65,co:7.6,ip:5,ncm:"39232190"}],
   mod:{h:0.010,sal:17.50,inss:28.8,f13:8.33,fer:11.11,fgts:8,ins:20,out:5},
   gif:{ener:0.40,agua:0.10,vapor:0.14,manP:0.09,manC:0.05,depM:0.16,depP:0.04,limp:0.09,lab:0.04,epi:0.02,seg:0.02,alv:0.01},
   adm:{adm:0.32,ti:0.04,cont:0.07,jur:0.02},com:{comis:3,frete:4,mkt:0.5,dev:0.8},fin:{antec:1.2,inad:0.5},
   fisc:{icS:12,ipi:0,csll:1.08,irpj:1.20},preco:16.80,vol:55000},
];
function calc(p:any,reg:string="LR"){
  const cum=reg==="LP";const pR=cum?PIS_COF.cum.pis:PIS_COF.ncum.pis;const cR=cum?PIS_COF.cum.cof:PIS_COF.ncum.cof;
  const mi=p.mp.map((m:any)=>{const ct=m.q*m.c;const ic=cum?0:ct*m.ic/100;const pi=cum?0:ct*m.pi/100;const co=cum?0:ct*m.co/100;return{...m,ct,ic,pi,co,liq:ct-ic-pi-co};});
  const mpB=mi.reduce((s:number,m:any)=>s+m.ct,0);const mpIc=mi.reduce((s:number,m:any)=>s+m.ic,0);const mpPi=mi.reduce((s:number,m:any)=>s+m.pi,0);const mpCo=mi.reduce((s:number,m:any)=>s+m.co,0);
  const enc=(p.mod.inss+p.mod.f13+p.mod.fer+p.mod.fgts+p.mod.ins+p.mod.out)/100;const modT=p.mod.h*p.mod.sal*(1+enc);
  const g=p.gif;const gifT=g.ener+g.agua+g.vapor+g.manP+g.manC+g.depM+g.depP+g.limp+g.lab+g.epi+g.seg+g.alv;
  const ci=mpB+modT+gifT;
  const a=p.adm;const admT=a.adm+a.ti+a.cont+a.jur;
  const comis=p.preco*p.com.comis/100;const frete=p.preco*p.com.frete/100;const mkt=p.preco*p.com.mkt/100;const dev=p.preco*p.com.dev/100;const comT=comis+frete+mkt+dev;
  const ant=p.preco*p.fin.antec/100;const inad=p.preco*p.fin.inad/100;const finT=ant+inad;
  const icD=p.preco*p.fisc.icS/100;const ipiD=p.preco*p.fisc.ipi/100;const piD=p.preco*pR/100;const coD=p.preco*cR/100;
  const icL=icD-mpIc;const piL=piD-mpPi;const coL=coD-mpCo;const tribT=icL+ipiD+piL+coL;
  const ircs=p.preco*(p.fisc.csll+p.fisc.irpj)/100;
  const custoT=ci+admT+comT+finT+tribT+ircs;const lucro=p.preco-custoT;
  const mBr=(p.preco-ci)/p.preco*100;const mOp=(p.preco-ci-admT-comT)/p.preco*100;const mLiq=lucro/p.preco*100;const mkp=(p.preco/ci-1)*100;
  const tribRef=p.preco*(REFORMA.cbs+REFORMA.ibs)/100;const credRef=mpB*(REFORMA.cbs+REFORMA.ibs)/100;const tribRefL=tribRef-credRef;
  return{mi,mpB,mpIc,mpPi,mpCo,enc,modT,gifT,ci,admT,comis,frete,mkt,dev,comT,ant,inad,finT,icD,ipiD,piD,coD,icL,piL,coL,tribT,ircs,custoT,lucro,mBr,mOp,mLiq,mkp,tribRef,credRef,tribRefL,pR,cR};
}
const Sec=({title,color=C.gol,children}:{title:string;color?:string;children:React.ReactNode})=>(<div style={{background:C.bg2,borderRadius:10,padding:12,border:`1px solid ${C.bd}`,marginBottom:10}}><div style={{fontSize:12,fontWeight:700,color,marginBottom:8,borderBottom:`1px solid ${C.bd}`,paddingBottom:6}}>{title}</div>{children}</div>);
const R=({l,v,c=C.tx,b,i,bg,s}:{l:string;v:string;c?:string;b?:boolean;i?:boolean;bg?:string;s?:string})=>(<div style={{display:"flex",justifyContent:"space-between",padding:i?"3px 6px 3px 22px":"3px 6px",borderBottom:`0.5px solid ${C.bd}20`,background:bg||"transparent"}}><div><span style={{fontSize:10,color:b?c:C.txm,fontWeight:b?700:400}}>{l}</span>{s&&<span style={{fontSize:8,color:C.txd,marginLeft:6}}>{s}</span>}</div><span style={{fontSize:10,color:c,fontWeight:b?700:400,fontFamily:"monospace"}}>{v}</span></div>);
export default function CustoPage(){
  const[pid,setPid]=useState("P01");const[tab,setTab]=useState("mapa");const[reg,setReg]=useState("LR");
  const p=PRODS.find((x:any)=>x.id===pid)||PRODS[0];const d=calc(p,reg);
  const tabs=[{id:"mapa",l:"🗺️ Mapa Custos",c:C.gol},{id:"ficha",l:"📋 Ficha Técnica",c:C.y},{id:"fiscal",l:"🏛️ Tributário",c:C.p},{id:"dre",l:"📊 DRE Produto",c:C.g},{id:"comp",l:"🏭 Comparativo",c:C.b},{id:"reforma",l:"🔮 Reforma Trib.",c:C.or},{id:"sim",l:"🎯 Simulador",c:C.cy}];
  return(<div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
    <div style={{background:C.esp,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
      <div><div style={{fontSize:16,fontWeight:700,color:C.gol}}>PS Gestão — Custo Industrial + Tributário Integrado</div><div style={{fontSize:9,color:C.txm}}>Mapa Completo | Legislação Vigente + Reforma (IBS/CBS) | Margens por Produto</div></div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <select value={reg} onChange={e=>setReg(e.target.value)} style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.p,borderRadius:6,padding:"4px 8px",fontSize:10}}><option value="LR">Lucro Real</option><option value="LP">Lucro Presumido</option></select>
        <select value={pid} onChange={e=>setPid(e.target.value)} style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.gol,borderRadius:6,padding:"4px 8px",fontSize:10}}>{PRODS.map((x:any)=><option key={x.id} value={x.id}>{x.nome}</option>)}</select>
        <a href="/dashboard" style={{padding:"4px 10px",border:`1px solid ${C.bd}`,borderRadius:6,color:C.txm,fontSize:10,textDecoration:"none"}}>← Voltar</a>
      </div>
    </div>
    <div style={{display:"flex",gap:2,padding:"6px 12px",background:C.bg2,overflowX:"auto",borderBottom:`1px solid ${C.bd}`}}>{tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:tab===t.id?700:500,background:tab===t.id?t.c+"20":"transparent",color:tab===t.id?t.c:C.txm,whiteSpace:"nowrap"}}>{t.l}</button>)}</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:6,padding:"10px 12px"}}>{[{l:"Custo Ind.",v:fR(d.ci),c:C.y},{l:"Custo Total",v:fR(d.custoT),c:C.or},{l:"Preço",v:fR(p.preco),c:C.g},{l:"M.Bruta",v:fP(d.mBr),c:d.mBr>=30?C.g:C.y},{l:"M.Operac.",v:fP(d.mOp),c:d.mOp>=15?C.g:C.y},{l:"M.Líquida",v:fP(d.mLiq),c:d.mLiq>=10?C.g:d.mLiq>=5?C.y:C.r},{l:"Lucro/kg",v:fR(d.lucro),c:d.lucro>0?C.g:C.r},{l:"Lucro/mês",v:fR(d.lucro*p.vol),c:d.lucro>0?C.g:C.r}].map((k,i)=><div key={i} style={{background:C.bg2,borderRadius:6,padding:"6px 8px",borderLeft:`2px solid ${k.c}`}}><div style={{fontSize:7,color:C.txd,textTransform:"uppercase"}}>{k.l}</div><div style={{fontSize:14,fontWeight:700,color:k.c}}>{k.v}</div></div>)}</div>
    <div style={{padding:"0 12px 12px",maxWidth:1400,margin:"0 auto"}}>
    {tab==="mapa"&&(<Sec title="🗺️ MAPA DE CUSTOS COMPLETO — Waterfall por kg">
      <R l="PREÇO DE VENDA" v={fR(p.preco)} c={C.g} b bg={C.g+"08"}/>
      <div style={{height:4}}/>
      <R l="1. MATÉRIA-PRIMA" v={`(${fR(d.mpB)})`} c={C.y} b s={fP(d.mpB/p.preco*100)}/>
      {d.mi.map((m:any,i:number)=><R key={i} l={m.it} v={`(${fR(m.ct)})`} c={C.txm} i s={`${m.q}${m.u} × ${fR(m.c)}`}/>)}
      <div style={{height:4}}/>
      <R l="2. MÃO DE OBRA DIRETA" v={`(${fR(d.modT)})`} c={C.b} b s={fP(d.modT/p.preco*100)}/>
      <R l={`Salário (${p.mod.h}h × ${fR(p.mod.sal)}/h)`} v={`(${fR(p.mod.h*p.mod.sal)})`} i/>
      <R l={`Encargos (${fP(d.enc*100)}): INSS ${p.mod.inss}% + 13° ${p.mod.f13}% + Férias ${p.mod.fer}% + FGTS ${p.mod.fgts}% + Insalub ${p.mod.ins}% + Outros ${p.mod.out}%`} v={`(${fR(d.modT-p.mod.h*p.mod.sal)})`} i/>
      <div style={{height:4}}/>
      <R l="3. GASTOS INDIRETOS FABRICAÇÃO" v={`(${fR(d.gifT)})`} c={C.p} b s={fP(d.gifT/p.preco*100)}/>
      {[["Energia elétrica",p.gif.ener],["Água",p.gif.agua],["Vapor/GLP",p.gif.vapor],["Manutenção preventiva",p.gif.manP],["Manutenção corretiva",p.gif.manC],["Depreciação máquinas",p.gif.depM],["Depreciação prédio",p.gif.depP],["Limpeza/higienização",p.gif.limp],["Laboratório/qualidade",p.gif.lab],["Uniforme/EPI",p.gif.epi],["Seguro industrial",p.gif.seg],["Alvará/licenças",p.gif.alv]].map(([n,v]:any,i:number)=><R key={i} l={n} v={`(${fR(v)})`} i/>)}
      <div style={{height:6}}/>
      <R l="= CUSTO INDUSTRIAL (CPV)" v={fR(d.ci)} c={C.gol} b bg={C.go+"10"}/>
      <R l="= MARGEM BRUTA" v={`${fR(p.preco-d.ci)} (${fP(d.mBr)})`} c={d.mBr>=30?C.g:C.y} b/>
      <div style={{height:8}}/>
      <R l="4. DESPESAS ADMINISTRATIVAS" v={`(${fR(d.admT)})`} c={C.or} b s={fP(d.admT/p.preco*100)}/>
      {[["Administrativo geral",p.adm.adm],["TI/sistemas",p.adm.ti],["Contabilidade",p.adm.cont],["Jurídico",p.adm.jur]].map(([n,v]:any,i:number)=><R key={i} l={n} v={`(${fR(v)})`} i/>)}
      <R l="5. DESPESAS COMERCIAIS" v={`(${fR(d.comT)})`} c={C.or} b s={fP(d.comT/p.preco*100)}/>
      <R l={`Comissão (${p.com.comis}%)`} v={`(${fR(d.comis)})`} i/><R l={`Frete (${p.com.frete}%)`} v={`(${fR(d.frete)})`} i/><R l={`Marketing (${p.com.mkt}%)`} v={`(${fR(d.mkt)})`} i/><R l={`Devoluções (${p.com.dev}%)`} v={`(${fR(d.dev)})`} i/>
      <R l="6. DESPESAS FINANCEIRAS" v={`(${fR(d.finT)})`} c={C.pk} b s={fP(d.finT/p.preco*100)}/>
      <R l={`Antecipação (${p.fin.antec}%)`} v={`(${fR(d.ant)})`} i/><R l={`Inadimplência (${p.fin.inad}%)`} v={`(${fR(d.inad)})`} i/>
      <div style={{height:6}}/>
      <R l="= RESULTADO OPERACIONAL" v={`${fR(p.preco-d.ci-d.admT-d.comT-d.finT)} (${fP(d.mOp)})`} c={d.mOp>0?C.g:C.r} b bg={d.mOp>0?C.g+"08":C.r+"08"}/>
      <div style={{height:8}}/>
      <R l="7. TRIBUTOS LÍQUIDOS" v={`(${fR(d.tribT)})`} c={C.r} b s={fP(d.tribT/p.preco*100)}/>
      <R l={`ICMS liq (${p.fisc.icS}% - créd)`} v={`(${fR(d.icL)})`} i/><R l={`PIS liq (${fP(d.pR)})`} v={`(${fR(d.piL)})`} i/><R l={`COFINS liq (${fP(d.cR)})`} v={`(${fR(d.coL)})`} i/><R l={`IPI (${p.fisc.ipi}%)`} v={`(${fR(d.ipiD)})`} i/>
      <R l="8. IRPJ + CSLL" v={`(${fR(d.ircs)})`} c={C.r} b s={fP(d.ircs/p.preco*100)}/>
      <div style={{height:8}}/>
      <R l="= CUSTO TOTAL COMPLETO / kg" v={fR(d.custoT)} c={C.or} b bg={C.or+"10"}/>
      <R l="= LUCRO LÍQUIDO / kg" v={fR(d.lucro)} c={d.lucro>0?C.g:C.r} b bg={d.lucro>0?C.g+"08":C.r+"08"}/>
      <R l="= MARGEM LÍQUIDA" v={fP(d.mLiq)} c={d.mLiq>0?C.g:C.r} b/>
      <R l="= MARKUP s/ custo industrial" v={fP(d.mkp)} c={C.gol} b/>
      <div style={{height:6}}/>
      <R l={`VOLUME: ${p.vol.toLocaleString()} kg/mês`} v={`FAT: ${fR(p.preco*p.vol)} | LUCRO: ${fR(d.lucro*p.vol)}`} c={d.lucro>0?C.g:C.r} b bg={C.bg3}/>
    </Sec>)}
    {tab==="ficha"&&(<Sec title={`📋 Ficha Técnica — ${p.nome}`}>
      <div style={{fontSize:9,color:C.txd,marginBottom:8}}>NCM: {p.ncm} | CEST: {p.cest} | CFOP: {p.cfop} | CST: {p.cst} | UN: {p.un}</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}><thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>{["Insumo","NCM","Qtd","Un","R$/un","Custo","ICMS%","Créd ICMS","PIS%","Créd PIS","COF%","Créd COF","Custo Líq"].map(h=><th key={h} style={{padding:"4px 2px",textAlign:h==="Insumo"?"left":"right",color:C.gol,fontSize:7}}>{h}</th>)}</tr></thead>
      <tbody>{d.mi.map((m:any,i:number)=><tr key={i} style={{borderBottom:`0.5px solid ${C.bd}15`}}><td style={{padding:"2px",color:C.tx,fontSize:8}}>{m.it}</td><td style={{padding:"2px",textAlign:"right",color:C.txd,fontSize:7}}>{m.ncm}</td><td style={{padding:"2px",textAlign:"right",fontSize:8}}>{m.q}</td><td style={{padding:"2px",textAlign:"right",color:C.txd,fontSize:7}}>{m.u}</td><td style={{padding:"2px",textAlign:"right"}}>{fN(m.c)}</td><td style={{padding:"2px",textAlign:"right",color:C.y,fontWeight:600}}>{fN(m.ct)}</td><td style={{padding:"2px",textAlign:"right",color:C.txd}}>{m.ic}%</td><td style={{padding:"2px",textAlign:"right",color:C.g}}>{fN(m.ic_val||m.ic)}</td><td style={{padding:"2px",textAlign:"right",color:C.txd}}>{m.pi}%</td><td style={{padding:"2px",textAlign:"right",color:C.g}}>{fN(m.pi_val||m.pi)}</td><td style={{padding:"2px",textAlign:"right",color:C.txd}}>{m.co}%</td><td style={{padding:"2px",textAlign:"right",color:C.g}}>{fN(m.co_val||m.co)}</td><td style={{padding:"2px",textAlign:"right",color:C.cy,fontWeight:600}}>{fN(m.liq)}</td></tr>)}
      <tr style={{borderTop:`2px solid ${C.go}`,background:C.go+"08"}}><td colSpan={5} style={{padding:"4px",fontWeight:700,color:C.gol}}>TOTAL</td><td style={{padding:"4px",textAlign:"right",fontWeight:700,color:C.y}}>{fN(d.mpB)}</td><td/><td style={{padding:"4px",textAlign:"right",fontWeight:700,color:C.g}}>{fN(d.mpIc)}</td><td/><td style={{padding:"4px",textAlign:"right",fontWeight:700,color:C.g}}>{fN(d.mpPi)}</td><td/><td style={{padding:"4px",textAlign:"right",fontWeight:700,color:C.g}}>{fN(d.mpCo)}</td><td style={{padding:"4px",textAlign:"right",fontWeight:700,color:C.cy}}>{fN(d.mpB-d.mpIc-d.mpPi-d.mpCo)}</td></tr></tbody></table>
    </Sec>)}
    {tab==="fiscal"&&(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
      <Sec title="🏛️ Débitos (venda)" color={C.r}><R l="Regime" v={reg==="LR"?"Lucro Real (não cumul.)":"L. Presumido (cumul.)"} c={C.p} b/><div style={{height:4}}/><R l={`ICMS (${p.fisc.icS}%)`} v={fR(d.icD)} c={C.r}/><R l={`IPI (${p.fisc.ipi}%)`} v={fR(d.ipiD)}/><R l={`PIS (${fP(d.pR)})`} v={fR(d.piD)} c={C.r}/><R l={`COFINS (${fP(d.cR)})`} v={fR(d.coD)} c={C.r}/><R l="TOTAL DÉBITOS" v={fR(d.icD+d.ipiD+d.piD+d.coD)} c={C.r} b bg={C.r+"08"}/></Sec>
      <Sec title="✅ Créditos (compras)" color={C.g}><R l="ICMS MP" v={fR(d.mpIc)} c={C.g}/><R l="PIS MP" v={reg==="LP"?"R$ 0 (cumul.)":fR(d.mpPi)} c={reg==="LP"?C.txd:C.g}/><R l="COFINS MP" v={reg==="LP"?"R$ 0 (cumul.)":fR(d.mpCo)} c={reg==="LP"?C.txd:C.g}/><R l="TOTAL CRÉDITOS" v={fR(d.mpIc+d.mpPi+d.mpCo)} c={C.g} b bg={C.g+"08"}/>{reg==="LP"&&<div style={{fontSize:9,color:C.y,padding:4}}>⚠️ Presumido: sem crédito PIS/COFINS</div>}</Sec>
      <Sec title="📊 Carga Líquida / kg" color={C.r}><R l="ICMS líquido" v={fR(d.icL)} c={C.r}/><R l="PIS líquido" v={fR(d.piL)} c={C.r}/><R l="COFINS líquido" v={fR(d.coL)} c={C.r}/><R l="IPI" v={fR(d.ipiD)}/><R l="IRPJ+CSLL" v={fR(d.ircs)} c={C.r}/><R l="CARGA TOTAL" v={fR(d.tribT+d.ircs)} c={C.r} b bg={C.r+"08"}/><R l="% sobre preço" v={fP((d.tribT+d.ircs)/p.preco*100)} c={C.r} b/></Sec>
      <Sec title="📋 Dados Fiscais" color={C.txm}>{[["NCM",p.ncm],["CEST",p.cest],["CST ICMS",p.cst],["CST PIS","01"],["CFOP Interna",p.cfop],["CFOP Interest.","6101"],["CFOP Export","7101"],["Origem","0 — Nacional"]].map(([k,v]:any,i:number)=><R key={i} l={k} v={v}/>)}</Sec>
    </div>)}
    {tab==="dre"&&(<Sec title="📊 DRE Gerencial do Produto — por kg">
      <R l="RECEITA BRUTA" v={fR(p.preco)} c={C.g} b bg={C.g+"08"}/>
      <R l="(-) Impostos s/ venda (ICMS+PIS+COF+IPI)" v={`(${fR(d.icD+d.piD+d.coD+d.ipiD)})`} c={C.r} i/><R l="(-) Devoluções" v={`(${fR(d.dev)})`} i/>
      <R l="= RECEITA LÍQUIDA" v={fR(p.preco-d.icD-d.piD-d.coD-d.ipiD-d.dev)} c={C.g} b/>
      <div style={{height:4}}/>
      <R l="(-) MP bruta" v={`(${fR(d.mpB)})`} c={C.y} i/><R l="(+) Créditos tributários MP" v={fR(d.mpIc+d.mpPi+d.mpCo)} c={C.g} i/><R l="(-) MOD" v={`(${fR(d.modT)})`} c={C.b} i/><R l="(-) GIF" v={`(${fR(d.gifT)})`} c={C.p} i/>
      <R l="= LUCRO BRUTO" v={fR(p.preco-d.icD-d.piD-d.coD-d.ipiD-d.dev-(d.mpB-d.mpIc-d.mpPi-d.mpCo)-d.modT-d.gifT)} c={C.g} b bg={C.g+"05"}/><R l="Margem Bruta" v={fP(d.mBr)} c={C.g}/>
      <div style={{height:4}}/>
      <R l="(-) Desp. administrativas" v={`(${fR(d.admT)})`} i/><R l="(-) Desp. comerciais" v={`(${fR(d.comT)})`} i/><R l="(-) Desp. financeiras" v={`(${fR(d.finT)})`} i/>
      <R l="= EBITDA / kg" v={fR(p.preco-d.ci-d.admT-d.comT-d.finT-d.tribT)} c={C.gol} b bg={C.go+"10"}/>
      <div style={{height:4}}/>
      <R l="(-) IRPJ+CSLL" v={`(${fR(d.ircs)})`} c={C.r} i/>
      <R l="= LUCRO LÍQUIDO / kg" v={fR(d.lucro)} c={d.lucro>0?C.g:C.r} b bg={d.lucro>0?C.g+"08":C.r+"08"}/><R l="MARGEM LÍQUIDA" v={fP(d.mLiq)} c={d.mLiq>0?C.g:C.r} b/>
      <div style={{height:6}}/>
      <R l={`Faturamento (${p.vol.toLocaleString()} kg)`} v={fR(p.preco*p.vol)} c={C.g} b bg={C.bg3}/><R l="Lucro mensal" v={fR(d.lucro*p.vol)} c={d.lucro>0?C.g:C.r} b bg={C.bg3}/><R l="Lucro anual" v={fR(d.lucro*p.vol*12)} c={d.lucro>0?C.g:C.r} b bg={C.bg3}/>
    </Sec>)}
    {tab==="comp"&&(<Sec title="🏭 Comparativo Produtos"><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}><thead><tr style={{borderBottom:`2px solid ${C.go}40`}}>{["Produto","MP","MOD","GIF","C.Ind","Trib","Adm","Com","Fin","IR","C.Total","Preço","Lucro","M.Líq","Lucro/mês"].map(h=><th key={h} style={{padding:"4px 2px",textAlign:h==="Produto"?"left":"right",color:C.gol,fontSize:7}}>{h}</th>)}</tr></thead>
      <tbody>{PRODS.map((x:any)=>{const c=calc(x,reg);return(<tr key={x.id} style={{borderBottom:`0.5px solid ${C.bd}20`,background:x.id===pid?C.go+"10":"transparent",cursor:"pointer"}} onClick={()=>setPid(x.id)}><td style={{padding:"3px",color:C.tx,fontWeight:600,fontSize:8}}>{x.nome}</td><td style={{padding:"3px",textAlign:"right"}}>{fN(c.mpB)}</td><td style={{padding:"3px",textAlign:"right"}}>{fN(c.modT)}</td><td style={{padding:"3px",textAlign:"right"}}>{fN(c.gifT)}</td><td style={{padding:"3px",textAlign:"right",color:C.gol,fontWeight:600}}>{fN(c.ci)}</td><td style={{padding:"3px",textAlign:"right",color:C.r}}>{fN(c.tribT)}</td><td style={{padding:"3px",textAlign:"right"}}>{fN(c.admT)}</td><td style={{padding:"3px",textAlign:"right"}}>{fN(c.comT)}</td><td style={{padding:"3px",textAlign:"right"}}>{fN(c.finT)}</td><td style={{padding:"3px",textAlign:"right",color:C.r}}>{fN(c.ircs)}</td><td style={{padding:"3px",textAlign:"right",color:C.or,fontWeight:600}}>{fN(c.custoT)}</td><td style={{padding:"3px",textAlign:"right",color:C.g}}>{fN(x.preco)}</td><td style={{padding:"3px",textAlign:"right",fontWeight:700,color:c.lucro>0?C.g:C.r}}>{fN(c.lucro)}</td><td style={{padding:"3px",textAlign:"right",fontWeight:700,color:c.mLiq>=10?C.g:c.mLiq>=5?C.y:C.r}}>{fP(c.mLiq)}</td><td style={{padding:"3px",textAlign:"right",fontWeight:700,color:c.lucro>0?C.g:C.r}}>{fR(c.lucro*x.vol)}</td></tr>);})}</tbody></table></div></Sec>)}
    {tab==="reforma"&&(<><Sec title="🔮 Reforma Tributária — IBS/CBS — Impacto" color={C.or}>
      <div style={{fontSize:10,color:C.txm,marginBottom:8,lineHeight:1.6}}>EC 132/2023 + LC 214/2025: CBS ({fP(REFORMA.cbs)}) substitui PIS+COFINS | IBS ({fP(REFORMA.ibs)}) substitui ICMS+ISS. IVA dual = {fP(REFORMA.cbs+REFORMA.ibs)}. Crédito amplo. Destino.</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div><R l="SISTEMA ATUAL" v="" c={C.p} b/><R l="ICMS liq" v={fR(d.icL)} c={C.r} i/><R l="PIS liq" v={fR(d.piL)} c={C.r} i/><R l="COFINS liq" v={fR(d.coL)} c={C.r} i/><R l="CARGA ATUAL" v={fR(d.tribT)} c={C.r} b bg={C.r+"08"}/><R l="% preço" v={fP(d.tribT/p.preco*100)} c={C.r}/></div>
        <div><R l="SISTEMA NOVO (IBS+CBS)" v="" c={C.or} b/><R l={`CBS (${fP(REFORMA.cbs)})`} v={fR(p.preco*REFORMA.cbs/100)} c={C.r} i/><R l={`IBS (${fP(REFORMA.ibs)})`} v={fR(p.preco*REFORMA.ibs/100)} c={C.r} i/><R l="(-) Crédito amplo MP" v={fR(d.credRef)} c={C.g} i/><R l="CARGA NOVA" v={fR(d.tribRefL)} c={C.or} b bg={C.or+"08"}/><R l="% preço" v={fP(d.tribRefL/p.preco*100)} c={C.or}/></div>
      </div>
      <div style={{height:6}}/><R l="DIFERENÇA" v={fR(d.tribRefL-d.tribT)} c={d.tribRefL>d.tribT?C.r:C.g} b bg={C.bg3}/><R l="Impacto mensal" v={fR((d.tribRefL-d.tribT)*p.vol)} c={d.tribRefL>d.tribT?C.r:C.g} b/>
    </Sec>
    <Sec title="📅 Transição 2026-2033" color={C.or}><table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>{["Ano","CBS","IBS","ICMS","PIS/COF","Nota"].map(h=><th key={h} style={{padding:"5px",textAlign:h==="Nota"?"left":"center",color:C.or,fontSize:9}}>{h}</th>)}</tr></thead>
      <tbody>{REFORMA.trans.map((t,i)=><tr key={i} style={{borderBottom:`0.5px solid ${C.bd}20`,background:t.a===2026?C.g+"08":t.a>=2033?C.or+"08":"transparent"}}><td style={{padding:"4px",textAlign:"center",fontWeight:700,color:t.a<=2026?C.g:C.or}}>{t.a}</td><td style={{padding:"4px",textAlign:"center"}}>{t.c}%</td><td style={{padding:"4px",textAlign:"center"}}>{t.i}%</td><td style={{padding:"4px",textAlign:"center",color:t.i>=100?C.r:C.g}}>{100-t.i}%</td><td style={{padding:"4px",textAlign:"center",color:t.c>=100?C.r:C.g}}>{100-t.c}%</td><td style={{padding:"4px",color:C.txm}}>{t.n}</td></tr>)}</tbody></table></Sec></>)}
    {tab==="sim"&&(<Sec title="🎯 Simulador — Lucro Real vs Presumido">
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>{(()=>{const lr=calc(p,"LR");const lp=calc(p,"LP");return(<table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${C.bd}`}}><th style={{padding:"4px",textAlign:"left",color:C.gol}}>Item</th><th style={{padding:"4px",textAlign:"right",color:C.g}}>L.Real</th><th style={{padding:"4px",textAlign:"right",color:C.p}}>L.Presumido</th><th style={{padding:"4px",textAlign:"right",color:C.gol}}>Diff</th></tr></thead>
          <tbody>{[{l:"PIS+COF déb",a:lr.piD+lr.coD,b:lp.piD+lp.coD},{l:"PIS+COF créd",a:lr.mpPi+lr.mpCo,b:0},{l:"PIS+COF líq",a:lr.piL+lr.coL,b:lp.piL+lp.coL},{l:"Carga total",a:lr.tribT,b:lp.tribT},{l:"Custo total",a:lr.custoT,b:lp.custoT},{l:"Lucro/kg",a:lr.lucro,b:lp.lucro},{l:"Lucro/mês",a:lr.lucro*p.vol,b:lp.lucro*p.vol}].map((r,i)=><tr key={i} style={{borderBottom:`0.5px solid ${C.bd}20`}}><td style={{padding:"3px",color:C.txm}}>{r.l}</td><td style={{padding:"3px",textAlign:"right",color:C.g}}>{fR(r.a)}</td><td style={{padding:"3px",textAlign:"right",color:C.p}}>{fR(r.b)}</td><td style={{padding:"3px",textAlign:"right",fontWeight:600,color:r.a>r.b?C.g:r.a<r.b?C.r:C.txm}}>{fR(r.a-r.b)}</td></tr>)}</tbody></table>);})()}
          <div style={{marginTop:8,padding:8,background:C.bg3,borderRadius:6,borderLeft:`3px solid ${C.g}`,fontSize:9,color:C.gol}}>{(()=>{const lr=calc(p,"LR");const lp=calc(p,"LP");return lr.lucro>lp.lucro?`✅ Lucro Real mais vantajoso: +${fR((lr.lucro-lp.lucro)*p.vol)}/mês pelos créditos PIS/COFINS.`:`⚠️ Presumido mais vantajoso: +${fR((lp.lucro-lr.lucro)*p.vol)}/mês.`;})()}</div>
        </div>
        <div><div style={{fontSize:11,color:C.or,marginBottom:8}}>Preço para margem-alvo:</div>
          {[5,8,10,12,15,18,20,25,30].map(m=>{const c=calc(p,reg);return(<div key={m} style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",borderBottom:`0.5px solid ${C.bd}20`}}><span style={{fontSize:10,color:Math.round(c.mLiq)===m?C.gol:C.txm,fontWeight:Math.round(c.mLiq)===m?700:400}}>{Math.round(c.mLiq)===m?"► ":""}Margem {m}%</span><span style={{fontSize:10,fontWeight:600,color:m>=15?C.g:m>=10?C.y:C.r}}>{fR(c.custoT/(1-m/100))}</span></div>);})}
        </div>
      </div>
    </Sec>)}
    </div>
    <div style={{textAlign:"center",padding:8,fontSize:8,color:C.txd}}>PS Gestão e Capital — Custo Industrial + Tributário v2.0 — Legislação vigente + Reforma EC 132/2023</div>
  </div>);
}
