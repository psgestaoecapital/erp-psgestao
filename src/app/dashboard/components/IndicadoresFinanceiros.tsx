"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#6B6960";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtP=(v:number)=>`${v.toFixed(1)}%`;
const fmtX=(v:number)=>`${v.toFixed(2)}x`;
const fmtD=(v:number)=>`${Math.round(v)} dias`;

type Indicador = {
  nome:string; sigla:string; valor:string; raw:number;
  ref:string; status:"bom"|"atencao"|"critico"|"neutro";
  explicacao:string;
};

function calcIndicadores(dre:any, bp:any, fin:any[]): {categoria:string;icon:string;cor:string;indicadores:Indicador[]}[] {
  // DRE values
  const receita = dre?.total_rec_operacional || dre?.total_receitas || 0;
  const despesas = dre?.total_despesas || 0;
  const resultado = dre?.resultado_periodo || (receita - despesas);
  const custosProdutos = dre?.top_custos?.reduce((s:number,c:any)=>s+c.valor,0) || despesas * 0.6;
  const custosFixos = despesas * 0.35; // estimated
  const custosVariaveis = despesas - custosFixos;
  const depreciacao = despesas * 0.03; // estimated
  const juros = fin.reduce((s,f)=>s+(f.saldoDevedor*f.taxaMensal/100),0);
  const ebit = resultado + juros;
  const ebitda = ebit + depreciacao;
  const lucroLiquido = resultado;

  // BP values
  const ativoCirculante = bp.ativo_circulante || 0;
  const ativoNaoCirculante = bp.ativo_nao_circulante || 0;
  const ativoTotal = ativoCirculante + ativoNaoCirculante;
  const passivoCirculante = bp.passivo_circulante || 0;
  const passivoNaoCirculante = bp.passivo_nao_circulante || 0;
  const passivoTotal = passivoCirculante + passivoNaoCirculante;
  const patrimonioLiquido = bp.patrimonio_liquido || 0;
  const estoques = bp.estoques || 0;
  const disponibilidades = bp.disponibilidades || 0;
  const contasReceber = bp.contas_receber || 0;
  const contasPagar = bp.contas_pagar || 0;

  // Capital investido = PL + Dívida financeira líquida
  const dividaFinanceira = fin.reduce((s,f)=>s+f.saldoDevedor,0);
  const capitalInvestido = patrimonioLiquido + dividaFinanceira - disponibilidades;
  const nopat = ebit * 0.75; // assuming ~25% tax

  // Margem de contribuição
  const margemContribuicao = receita > 0 ? (receita - custosVariaveis) / receita : 0;

  // Ponto de equilíbrio
  const peContabil = margemContribuicao > 0 ? custosFixos / margemContribuicao : 0;
  const peEconomico = margemContribuicao > 0 ? (custosFixos + receita * 0.1) / margemContribuicao : 0; // 10% lucro desejado
  const peFinanceiro = margemContribuicao > 0 ? (custosFixos - depreciacao) / margemContribuicao : 0;

  // PMR, PMP (estimated from balances)
  const receitaDiaria = receita / 30;
  const despesaDiaria = despesas / 30;
  const pmr = receitaDiaria > 0 ? contasReceber / receitaDiaria : 0;
  const pmp = despesaDiaria > 0 ? contasPagar / despesaDiaria : 0;
  const cicloFinanceiro = pmr - pmp;

  const st=(v:number,bom:number,atencao:number,maior:boolean=true):"bom"|"atencao"|"critico"|"neutro"=>{
    if(v===0&&bom===0) return "neutro";
    if(maior) return v>=bom?"bom":v>=atencao?"atencao":"critico";
    return v<=bom?"bom":v<=atencao?"atencao":"critico";
  };

  return [
    {categoria:"Ponto de Equilíbrio",icon:"🎯",cor:GOL,indicadores:[
      {nome:"PE Contábil",sigla:"BEP",valor:fmtR(peContabil),raw:peContabil,ref:"Receita mínima para cobrir todos os custos",status:receita>0&&receita>=peContabil?"bom":receita>=peContabil*0.8?"atencao":"critico",
        explicacao:"Faturamento mínimo para não ter prejuízo. Receita = Custos Fixos ÷ Margem de Contribuição."},
      {nome:"PE Econômico",sigla:"BEP-E",valor:fmtR(peEconomico),raw:peEconomico,ref:"PE + lucro mínimo de 10%",status:receita>=peEconomico?"bom":"atencao",
        explicacao:"Faturamento para cobrir custos E gerar 10% de lucro sobre a receita."},
      {nome:"PE Financeiro",sigla:"BEP-F",valor:fmtR(peFinanceiro),raw:peFinanceiro,ref:"PE sem depreciação (cash real)",status:receita>=peFinanceiro?"bom":"atencao",
        explicacao:"Faturamento para pagar as contas reais (exclui depreciação que não é desembolso)."},
      {nome:"Margem de Contribuição",sigla:"MC",valor:fmtP(margemContribuicao*100),raw:margemContribuicao*100,ref:"> 40% ideal",status:st(margemContribuicao*100,40,25),
        explicacao:"% da receita que sobra após pagar custos variáveis. Quanto maior, mais rápido cobre os custos fixos."},
      {nome:"Margem de Segurança",sigla:"MS",valor:receita>0&&peContabil>0?fmtP((receita-peContabil)/receita*100):"—",raw:receita>0&&peContabil>0?(receita-peContabil)/receita*100:0,ref:"> 20% seguro",status:st(receita>0&&peContabil>0?(receita-peContabil)/receita*100:0,20,10),
        explicacao:"Quanto a receita pode cair antes de dar prejuízo. > 20% é seguro, < 10% é perigoso."},
    ]},
    {categoria:"Rentabilidade",icon:"📈",cor:G,indicadores:[
      {nome:"Margem Bruta",sigla:"MB",valor:fmtP(receita>0?(receita-custosProdutos)/receita*100:0),raw:receita>0?(receita-custosProdutos)/receita*100:0,ref:"> 30%",status:st(receita>0?(receita-custosProdutos)/receita*100:0,30,15),
        explicacao:"% que sobra após pagar o custo dos produtos/serviços vendidos."},
      {nome:"Margem Operacional (EBIT)",sigla:"MO",valor:fmtP(receita>0?ebit/receita*100:0),raw:receita>0?ebit/receita*100:0,ref:"> 15%",status:st(receita>0?ebit/receita*100:0,15,5),
        explicacao:"% de lucro da operação antes de juros e impostos."},
      {nome:"Margem EBITDA",sigla:"EBITDA%",valor:fmtP(receita>0?ebitda/receita*100:0),raw:receita>0?ebitda/receita*100:0,ref:"> 20%",status:st(receita>0?ebitda/receita*100:0,20,10),
        explicacao:"Geração de caixa operacional antes de investimentos. O indicador mais usado pelo mercado."},
      {nome:"Margem Líquida",sigla:"ML",valor:fmtP(receita>0?lucroLiquido/receita*100:0),raw:receita>0?lucroLiquido/receita*100:0,ref:"> 10%",status:st(receita>0?lucroLiquido/receita*100:0,10,3),
        explicacao:"% da receita que vira lucro real no final. Quanto maior, melhor."},
      {nome:"ROE",sigla:"ROE",valor:patrimonioLiquido>0?fmtP(lucroLiquido*12/patrimonioLiquido*100):"—",raw:patrimonioLiquido>0?lucroLiquido*12/patrimonioLiquido*100:0,ref:"> 15% a.a.",status:st(patrimonioLiquido>0?lucroLiquido*12/patrimonioLiquido*100:0,15,8),
        explicacao:"Retorno sobre o capital dos sócios (anualizado). Compara com CDI (~12%) — se ROE < CDI, melhor investir no banco."},
      {nome:"ROA",sigla:"ROA",valor:ativoTotal>0?fmtP(lucroLiquido*12/ativoTotal*100):"—",raw:ativoTotal>0?lucroLiquido*12/ativoTotal*100:0,ref:"> 8% a.a.",status:st(ativoTotal>0?lucroLiquido*12/ativoTotal*100:0,8,3),
        explicacao:"Retorno sobre todos os ativos da empresa (anualizado). Mostra eficiência no uso dos recursos."},
      {nome:"ROIC",sigla:"ROIC",valor:capitalInvestido>0?fmtP(nopat*12/capitalInvestido*100):"—",raw:capitalInvestido>0?nopat*12/capitalInvestido*100:0,ref:"> WACC (~14%)",status:st(capitalInvestido>0?nopat*12/capitalInvestido*100:0,14,8),
        explicacao:"Retorno sobre capital investido (anualizado). Se ROIC > custo do capital, a empresa CRIA valor."},
      {nome:"EBITDA (R$)",sigla:"EBITDA",valor:fmtR(ebitda),raw:ebitda,ref:"Positivo e crescente",status:ebitda>0?"bom":"critico",
        explicacao:"Geração de caixa operacional em valor absoluto. Base para valuation."},
    ]},
    {categoria:"Liquidez",icon:"💧",cor:B,indicadores:[
      {nome:"Liquidez Corrente",sigla:"LC",valor:passivoCirculante>0?fmtX(ativoCirculante/passivoCirculante):"—",raw:passivoCirculante>0?ativoCirculante/passivoCirculante:0,ref:"> 1.5x",status:st(passivoCirculante>0?ativoCirculante/passivoCirculante:0,1.5,1.0),
        explicacao:"Para cada R$ 1 de dívida de curto prazo, quantos R$ a empresa tem. > 1.5x é saudável."},
      {nome:"Liquidez Seca",sigla:"LS",valor:passivoCirculante>0?fmtX((ativoCirculante-estoques)/passivoCirculante):"—",raw:passivoCirculante>0?(ativoCirculante-estoques)/passivoCirculante:0,ref:"> 1.0x",status:st(passivoCirculante>0?(ativoCirculante-estoques)/passivoCirculante:0,1.0,0.7),
        explicacao:"Igual à corrente mas sem estoque (que pode demorar para virar dinheiro)."},
      {nome:"Liquidez Imediata",sigla:"LI",valor:passivoCirculante>0?fmtX(disponibilidades/passivoCirculante):"—",raw:passivoCirculante>0?disponibilidades/passivoCirculante:0,ref:"> 0.3x",status:st(passivoCirculante>0?disponibilidades/passivoCirculante:0,0.3,0.1),
        explicacao:"Quanto a empresa tem em caixa para pagar dívidas de curto prazo AGORA. > 0.3x é seguro."},
      {nome:"Liquidez Geral",sigla:"LG",valor:(passivoCirculante+passivoNaoCirculante)>0?fmtX((ativoCirculante+ativoNaoCirculante)/(passivoCirculante+passivoNaoCirculante)):"—",raw:(passivoCirculante+passivoNaoCirculante)>0?(ativoCirculante+ativoNaoCirculante)/(passivoCirculante+passivoNaoCirculante):0,ref:"> 1.0x",status:st((passivoCirculante+passivoNaoCirculante)>0?(ativoCirculante+ativoNaoCirculante)/(passivoCirculante+passivoNaoCirculante):0,1.0,0.7),
        explicacao:"Capacidade de pagar TODAS as dívidas (curto + longo prazo) com todos os ativos."},
    ]},
    {categoria:"Endividamento",icon:"🏦",cor:Y,indicadores:[
      {nome:"Endividamento Geral",sigla:"EG",valor:ativoTotal>0?fmtP(passivoTotal/ativoTotal*100):"—",raw:ativoTotal>0?passivoTotal/ativoTotal*100:0,ref:"< 60%",status:st(ativoTotal>0?passivoTotal/ativoTotal*100:0,40,60,false),
        explicacao:"% dos ativos financiados por dívida. < 60% é saudável, > 80% é perigoso."},
      {nome:"Grau de Alavancagem",sigla:"D/E",valor:patrimonioLiquido>0?fmtX(passivoTotal/patrimonioLiquido):"—",raw:patrimonioLiquido>0?passivoTotal/patrimonioLiquido:0,ref:"< 2.0x",status:st(patrimonioLiquido>0?passivoTotal/patrimonioLiquido:0,1.5,2.5,false),
        explicacao:"Quanto de dívida para cada R$ 1 de capital próprio. < 2x é aceitável."},
      {nome:"Composição do Endividamento",sigla:"CE",valor:(passivoCirculante+passivoNaoCirculante)>0?fmtP(passivoCirculante/(passivoCirculante+passivoNaoCirculante)*100):"—",raw:(passivoCirculante+passivoNaoCirculante)>0?passivoCirculante/(passivoCirculante+passivoNaoCirculante)*100:0,ref:"< 50% ideal",status:st((passivoCirculante+passivoNaoCirculante)>0?passivoCirculante/(passivoCirculante+passivoNaoCirculante)*100:0,40,60,false),
        explicacao:"% da dívida que vence no curto prazo. Ideal: mais dívida no LP, menos pressão no caixa."},
      {nome:"Cobertura de Juros",sigla:"ICR",valor:juros>0?fmtX(ebitda/juros):"Sem juros",raw:juros>0?ebitda/juros:99,ref:"> 3.0x",status:juros>0?st(ebitda/juros,3,1.5):"bom",
        explicacao:"Quantas vezes o EBITDA cobre os juros. < 1.5x = risco de não pagar. > 3x = confortável."},
      {nome:"Dívida Líq / EBITDA",sigla:"DL/EBITDA",valor:ebitda>0?fmtX((dividaFinanceira-disponibilidades)/(ebitda*12)):"—",raw:ebitda>0?(dividaFinanceira-disponibilidades)/(ebitda*12):0,ref:"< 2.5x",status:st(ebitda>0?(dividaFinanceira-disponibilidades)/(ebitda*12):0,2.0,3.5,false),
        explicacao:"Anos necessários para pagar toda a dívida com o EBITDA. < 2.5x é saudável."},
    ]},
    {categoria:"Eficiência Operacional",icon:"⚡",cor:P,indicadores:[
      {nome:"Giro do Ativo",sigla:"GA",valor:ativoTotal>0?fmtX(receita*12/ativoTotal):"—",raw:ativoTotal>0?receita*12/ativoTotal:0,ref:"> 1.0x a.a.",status:st(ativoTotal>0?receita*12/ativoTotal:0,1.0,0.5),
        explicacao:"Quantas vezes a receita anual gira sobre o ativo total. Maior = mais eficiente."},
      {nome:"Prazo Médio Recebimento",sigla:"PMR",valor:fmtD(pmr),raw:pmr,ref:"< 30 dias",status:st(pmr,30,60,false),
        explicacao:"Tempo médio para receber dos clientes. Menor = melhor para o caixa."},
      {nome:"Prazo Médio Pagamento",sigla:"PMP",valor:fmtD(pmp),raw:pmp,ref:"> 30 dias",status:st(pmp,30,15,true),
        explicacao:"Tempo médio para pagar fornecedores. Maior = mais fôlego de caixa."},
      {nome:"Ciclo Financeiro",sigla:"CF",valor:fmtD(cicloFinanceiro),raw:cicloFinanceiro,ref:"< 30 dias",status:st(cicloFinanceiro,20,45,false),
        explicacao:"PMR - PMP. Quantos dias a empresa financia do próprio bolso. Negativo é ótimo (recebe antes de pagar)."},
    ]},
  ];
}

export default function IndicadoresFinanceiros({realData,empresaId}:{realData:any;empresaId:string}){
  const [bp,setBp]=useState<any>({});
  const [fin,setFin]=useState<any[]>([]);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({"Ponto de Equilíbrio":true,"Rentabilidade":true});

  useEffect(()=>{
    if(!empresaId)return;
    const load=async()=>{
      // Load BP
      const{data:bpData}=await supabase.from("balanco_patrimonial").select("*").eq("company_id",empresaId);
      if(bpData){
        const vals:Record<string,number>={};
        bpData.forEach((i:any)=>{
          vals[i.nome]=Number(i.valor)||0;
          // Aggregate by group
          if(i.grupo==="Ativo Circulante") vals.ativo_circulante=(vals.ativo_circulante||0)+Number(i.valor);
          if(i.grupo==="Ativo Não Circulante") vals.ativo_nao_circulante=(vals.ativo_nao_circulante||0)+Number(i.valor);
          if(i.grupo==="Passivo Circulante") vals.passivo_circulante=(vals.passivo_circulante||0)+Number(i.valor);
          if(i.grupo==="Passivo Não Circulante") vals.passivo_nao_circulante=(vals.passivo_nao_circulante||0)+Number(i.valor);
          if(i.grupo==="Patrimônio Líquido") vals.patrimonio_liquido=(vals.patrimonio_liquido||0)+Number(i.valor);
        });
        vals.disponibilidades=(vals["Caixa e Equivalentes"]||0)+(vals["Bancos Conta Corrente"]||0)+(vals["Aplicações Financeiras CP"]||0);
        vals.estoques=vals["Estoques"]||0;
        vals.contas_receber=vals["Contas a Receber"]||0;
        vals.contas_pagar=vals["Fornecedores"]||0;
        setBp(vals);
      }
      // Load financiamentos
      const{data:finData}=await supabase.from("financiamentos").select("*").eq("company_id",empresaId);
      if(finData) setFin(finData.map((f:any)=>({saldoDevedor:Number(f.saldo_devedor)||0,taxaMensal:Number(f.taxa_mensal)||0})));
    };
    load();
  },[empresaId]);

  const categorias=calcIndicadores(realData,bp,fin);
  const statusCfg={
    bom:{cor:G,bg:"rgba(52,211,153,0.12)",border:"rgba(52,211,153,0.25)",label:"✅ Saudável",icon:"✅"},
    atencao:{cor:Y,bg:"rgba(251,191,36,0.12)",border:"rgba(251,191,36,0.25)",label:"⚠️ Atenção",icon:"⚠️"},
    critico:{cor:R,bg:"rgba(248,113,113,0.12)",border:"rgba(248,113,113,0.25)",label:"🔴 Crítico",icon:"🔴"},
    neutro:{cor:TXM,bg:"rgba(176,171,159,0.06)",border:"rgba(176,171,159,0.15)",label:"—",icon:"◽"},
  };

  // Count totals
  const allInds = categorias.flatMap(c=>c.indicadores);
  const totalBom = allInds.filter(i=>i.status==="bom").length;
  const totalAtencao = allInds.filter(i=>i.status==="atencao").length;
  const totalCritico = allInds.filter(i=>i.status==="critico").length;

  return(
    <div>
      {/* Health Score Bar */}
      <div style={{background:"linear-gradient(135deg, #161614, #1E1E1B)",borderRadius:16,padding:"18px 20px",border:`1px solid ${BD}`,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:"0 4px 12px rgba(198,151,63,0.3)"}}>📊</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:TX}}>Saúde Financeira</div>
              <div style={{fontSize:10,color:TXM}}>{allInds.length} indicadores analisados</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <div style={{padding:"4px 12px",borderRadius:8,background:G+"15",border:`1px solid ${G}30`,display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12}}>✅</span><span style={{fontSize:13,fontWeight:700,color:G}}>{totalBom}</span>
            </div>
            <div style={{padding:"4px 12px",borderRadius:8,background:Y+"15",border:`1px solid ${Y}30`,display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12}}>⚠️</span><span style={{fontSize:13,fontWeight:700,color:Y}}>{totalAtencao}</span>
            </div>
            <div style={{padding:"4px 12px",borderRadius:8,background:R+"15",border:`1px solid ${R}30`,display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12}}>🔴</span><span style={{fontSize:13,fontWeight:700,color:R}}>{totalCritico}</span>
            </div>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",background:"#0C0C0A"}}>
          {totalBom>0&&<div style={{width:`${totalBom/allInds.length*100}%`,background:G,transition:"width 0.5s"}}/>}
          {totalAtencao>0&&<div style={{width:`${totalAtencao/allInds.length*100}%`,background:Y,transition:"width 0.5s"}}/>}
          {totalCritico>0&&<div style={{width:`${totalCritico/allInds.length*100}%`,background:R,transition:"width 0.5s"}}/>}
        </div>
      </div>

      {/* Top 6 KPIs - Hero Cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:12,marginBottom:16}}>
        {[
          {label:"Ponto de Equilíbrio",value:categorias[0]?.indicadores[0]?.valor||"—",cor:GOL,icon:"🎯",status:categorias[0]?.indicadores[0]?.status||"neutro"},
          {label:"Margem EBITDA",value:categorias[1]?.indicadores[2]?.valor||"—",cor:G,icon:"📈",status:categorias[1]?.indicadores[2]?.status||"neutro"},
          {label:"ROE (anual)",value:categorias[1]?.indicadores[4]?.valor||"—",cor:categorias[1]?.indicadores[4]?.raw>15?G:categorias[1]?.indicadores[4]?.raw>0?Y:R,icon:"💰",status:categorias[1]?.indicadores[4]?.status||"neutro"},
          {label:"Liquidez Corrente",value:categorias[2]?.indicadores[0]?.valor||"—",cor:B,icon:"💧",status:categorias[2]?.indicadores[0]?.status||"neutro"},
          {label:"Dív.Líq / EBITDA",value:categorias[3]?.indicadores[4]?.valor||"—",cor:Y,icon:"🏦",status:categorias[3]?.indicadores[4]?.status||"neutro"},
          {label:"Ciclo Financeiro",value:categorias[4]?.indicadores[3]?.valor||"—",cor:P,icon:"⚡",status:categorias[4]?.indicadores[3]?.status||"neutro"},
        ].map((k,i)=>{
          const sc=statusCfg[k.status as keyof typeof statusCfg]||statusCfg.neutro;
          return(
          <div key={i} style={{
            background:"linear-gradient(160deg, #1A1918 0%, #141412 100%)",
            borderRadius:18,padding:"20px 16px",textAlign:"center",position:"relative",overflow:"hidden",
            border:`1.5px solid ${sc.border}`,
            boxShadow:`0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px ${sc.cor}10, inset 0 1px 0 rgba(255,255,255,0.03)`,
            transition:"all 0.2s",cursor:"default",
          }}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 8px 30px rgba(0,0,0,0.5), 0 0 20px ${k.cor}20, inset 0 1px 0 rgba(255,255,255,0.05)`;}}
          onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=`0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px ${sc.cor}10, inset 0 1px 0 rgba(255,255,255,0.03)`;}}
          >
            {/* Top accent line */}
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg, transparent, ${k.cor}, transparent)`,opacity:0.7}}/>
            {/* Icon */}
            <div style={{
              width:52,height:52,borderRadius:14,margin:"0 auto 12px",
              background:`linear-gradient(145deg, ${k.cor}20, ${k.cor}08)`,
              border:`2px solid ${k.cor}40`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,
              boxShadow:`0 4px 16px ${k.cor}25, inset 0 1px 0 rgba(255,255,255,0.08)`,
            }}>{k.icon}</div>
            {/* Label */}
            <div style={{fontSize:10,color:TXM,textTransform:"uppercase",letterSpacing:1.2,marginBottom:6,fontWeight:600}}>{k.label}</div>
            {/* Value */}
            <div style={{fontSize:20,fontWeight:800,color:k.cor,letterSpacing:-0.5,textShadow:`0 0 24px ${k.cor}30`}}>{k.value}</div>
            {/* Status dot */}
            <div style={{marginTop:8}}>
              <span style={{fontSize:9,padding:"3px 10px",borderRadius:8,background:sc.bg,color:sc.cor,fontWeight:600,border:`1px solid ${sc.border}`}}>{sc.label}</span>
            </div>
          </div>
        );})}
      </div>

      {/* Indicator Categories */}
      {categorias.map((cat,ci)=>{
        const isOpen=!!expanded[cat.categoria];
        const catCritico=cat.indicadores.filter(i=>i.status==="critico").length;
        const catBom=cat.indicadores.filter(i=>i.status==="bom").length;
        return(
          <div key={ci} style={{marginBottom:10}}>
            {/* Category Header */}
            <div onClick={()=>setExpanded({...expanded,[cat.categoria]:!isOpen})} style={{
              display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"12px 16px",background:"linear-gradient(135deg, #161614, #1E1E1B)",
              borderRadius:isOpen?"14px 14px 0 0":14,border:`1px solid ${BD}`,
              cursor:"pointer",borderLeft:`4px solid ${cat.cor}`,
            }}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:8,background:`${cat.cor}15`,border:`1px solid ${cat.cor}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,boxShadow:`0 2px 8px ${cat.cor}15`}}>{cat.icon}</div>
                <div>
                  <span style={{fontSize:14,fontWeight:600,color:TX}}>{cat.categoria}</span>
                  <div style={{display:"flex",gap:6,marginTop:2}}>
                    {catBom>0&&<span style={{fontSize:9,color:G}}>✅ {catBom}</span>}
                    {cat.indicadores.filter(i=>i.status==="atencao").length>0&&<span style={{fontSize:9,color:Y}}>⚠️ {cat.indicadores.filter(i=>i.status==="atencao").length}</span>}
                    {catCritico>0&&<span style={{fontSize:9,color:R}}>🔴 {catCritico}</span>}
                  </div>
                </div>
              </div>
              <span style={{fontSize:14,color:TXM,transition:"transform 0.3s",transform:isOpen?"rotate(180deg)":""}}>▾</span>
            </div>

            {/* Category Content */}
            {isOpen&&(
              <div style={{background:"#141412",borderRadius:"0 0 14px 14px",border:`1px solid ${BD}`,borderTop:"none",padding:"6px 8px"}}>
                {cat.indicadores.map((ind,ii)=>{
                  const sc=statusCfg[ind.status];
                  return(
                    <div key={ii} style={{
                      display:"grid",gridTemplateColumns:"minmax(200px,2fr) 120px 100px 100px",gap:8,alignItems:"center",
                      padding:"12px 10px",borderRadius:10,marginBottom:2,
                      background:ii%2===0?"rgba(255,255,255,0.015)":"transparent",
                      borderLeft:`3px solid ${sc.cor}40`,
                    }}>
                      {/* Name + explanation */}
                      <div>
                        <div style={{fontSize:13,fontWeight:600,color:TX,marginBottom:2}}>
                          <span style={{display:"inline-block",padding:"1px 6px",borderRadius:4,background:`${cat.cor}15`,color:cat.cor,fontSize:10,fontWeight:700,marginRight:6,border:`1px solid ${cat.cor}25`}}>{ind.sigla}</span>
                          {ind.nome}
                        </div>
                        <div style={{fontSize:10,color:"#D0CCC3",lineHeight:1.5}}>{ind.explicacao}</div>
                      </div>

                      {/* Value */}
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:17,fontWeight:700,color:sc.cor,letterSpacing:-0.3}}>{ind.valor}</div>
                      </div>

                      {/* Status badge */}
                      <div style={{textAlign:"center"}}>
                        <span style={{
                          fontSize:10,padding:"4px 10px",borderRadius:8,fontWeight:600,
                          background:sc.bg,color:sc.cor,border:`1px solid ${sc.border}`,
                          display:"inline-block",
                        }}>{sc.label}</span>
                      </div>

                      {/* Reference */}
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:10,color:TXM,padding:"4px 8px",borderRadius:6,background:"rgba(255,255,255,0.03)",border:`1px solid ${BD}`,display:"inline-block"}}>
                          Ref: {ind.ref}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* AI Analysis */}
      {realData&&(
        <div style={{marginTop:14,background:"linear-gradient(135deg, #161614, #1E1E1B)",borderRadius:14,padding:18,border:`1px solid ${GO}30`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:BG,boxShadow:"0 4px 12px rgba(198,151,63,0.3)"}}>PS</div>
            <div>
              <span style={{fontSize:13,fontWeight:600,color:GOL}}>Diagnóstico do Consultor Digital</span>
              <div style={{fontSize:9,color:TXM}}>Baseado nos {allInds.length} indicadores analisados</div>
            </div>
          </div>
          {categorias.map(cat=>cat.indicadores.filter(i=>i.status==="critico")).flat().map((ind,i)=>(
            <div key={`c${i}`} style={{padding:"10px 14px",borderRadius:10,background:R+"10",border:`1px solid ${R}25`,marginBottom:6,fontSize:12,color:TX,display:"flex",gap:10,alignItems:"flex-start"}}>
              <span style={{fontSize:14,flexShrink:0}}>🔴</span>
              <div><strong style={{color:R}}>{ind.sigla} = {ind.valor}</strong> <span style={{color:TXM}}>— {ind.explicacao} Referência: {ind.ref}.</span></div>
            </div>
          ))}
          {categorias.map(cat=>cat.indicadores.filter(i=>i.status==="atencao")).flat().slice(0,3).map((ind,i)=>(
            <div key={`a${i}`} style={{padding:"10px 14px",borderRadius:10,background:Y+"10",border:`1px solid ${Y}25`,marginBottom:6,fontSize:12,color:TX,display:"flex",gap:10,alignItems:"flex-start"}}>
              <span style={{fontSize:14,flexShrink:0}}>⚠️</span>
              <div><strong style={{color:Y}}>{ind.sigla} = {ind.valor}</strong> <span style={{color:"#D0CCC3"}}>— Próximo do limite ({ind.ref}). Monitorar tendência.</span></div>
            </div>
          ))}
          {totalBom>allInds.length*0.6&&(
            <div style={{padding:"10px 14px",borderRadius:10,background:G+"10",border:`1px solid ${G}25`,fontSize:12,color:TX,display:"flex",gap:10,alignItems:"flex-start"}}>
              <span style={{fontSize:14,flexShrink:0}}>✅</span>
              <div><strong style={{color:G}}>{totalBom} de {allInds.length} indicadores saudáveis.</strong> <span style={{color:"#D0CCC3"}}>Empresa bem posicionada. Preencha o Balanço Patrimonial para indicadores ainda mais precisos.</span></div>
            </div>
          )}
          <div style={{fontSize:9,color:TXM,marginTop:10,padding:"6px 10px",borderRadius:6,background:"rgba(0,0,0,0.2)"}}>
            * ROE, ROA e ROIC são anualizados (mensal × 12). Para máxima precisão, preencha Balanço Patrimonial e Financiamentos.
          </div>
        </div>
      )}
    </div>
  );
}
