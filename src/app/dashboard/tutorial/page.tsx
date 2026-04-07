"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",T="#2DD4BF",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

type TutorialStep = { titulo: string; desc: string; dica?: string; acao?: string; };
type Tutorial = {
  id: string; titulo: string; desc: string; icon: string; cor: string;
  categoria: string; duracao: string; nivel: "iniciante"|"intermediário"|"avançado";
  steps: TutorialStep[];
};

const tutoriais: Tutorial[] = [
  // ═══ PRIMEIROS PASSOS ═══
  { id:"t01", titulo:"Primeiro Acesso ao Sistema", desc:"Configure sua conta e conheça o painel principal", icon:"🚀", cor:GO, categoria:"Primeiros Passos", duracao:"5 min", nivel:"iniciante",
    steps:[
      {titulo:"Login no Sistema",desc:"Acesse erp-psgestao.vercel.app e faça login com o e-mail e senha fornecidos no convite. Se ainda não tem conta, peça um link de convite ao administrador.",dica:"Guarde sua senha em local seguro. Use o 'Esqueci minha senha' se precisar recuperar."},
      {titulo:"Conheça o Dashboard",desc:"Ao entrar, você verá o Painel Geral com KPIs de receita, despesas e resultado. Os números são reais, vindos da integração com o Omie.",acao:"Observe os cards de alerta no topo: verde (ok), amarelo (atenção) e vermelho (crítico)."},
      {titulo:"Navegue pelas Abas",desc:"Na parte superior, clique nas abas: Painel Geral, Negócios, Resultado, Financeiro, Preços e Relatório. Cada aba mostra uma perspectiva diferente dos dados.",dica:"As abas que você vê dependem do seu nível de acesso (role)."},
      {titulo:"Guia de Configuração",desc:"Clique no botão '⚡ N/6 etapas' no canto superior direito para ver o que falta configurar. Siga as 6 etapas para ativar o sistema completo.",acao:"Complete todas as etapas para desbloquear a análise IA automática."},
    ]},
  { id:"t02", titulo:"Cadastrar Empresas e Grupos", desc:"Adicione CNPJs e organize em grupos", icon:"🏢", cor:B, categoria:"Primeiros Passos", duracao:"4 min", nivel:"iniciante",
    steps:[
      {titulo:"Acesse o Painel Admin",desc:"Clique em '⚙️ Admin' no canto superior direito do dashboard. Você verá a aba 'Empresas' com a lista atual.",acao:"Clique em '+ Empresa' para cadastrar uma nova."},
      {titulo:"Crie um Grupo",desc:"Antes de cadastrar empresas, crie um grupo para organizá-las. Clique em '+ Grupo', dê um nome (ex: 'Grupo Tryo Gessos') e escolha uma cor.",dica:"Use grupos para separar empresas de clientes diferentes. Cada grupo tem sua cor."},
      {titulo:"Cadastre a Empresa",desc:"Clique em '+ Empresa', preencha Razão Social, CNPJ, Cidade/UF. No campo 'Grupo', selecione o grupo criado.",acao:"Repita para cada CNPJ do mesmo cliente."},
      {titulo:"Verifique no Dashboard",desc:"Volte ao Dashboard. No seletor de empresas (canto superior), você verá os grupos com '📁' e as empresas dentro de cada grupo.",dica:"Selecione o grupo para ver dados consolidados, ou a empresa individual para ver dados isolados."},
    ]},
  { id:"t03", titulo:"Convidar Usuários e Definir Acessos", desc:"Adicione sócios, financeiro, operadores", icon:"👥", cor:P, categoria:"Primeiros Passos", duracao:"3 min", nivel:"iniciante",
    steps:[
      {titulo:"Gerar Convite",desc:"Em Admin → aba 'Convites', selecione a empresa, escolha o nível de acesso (Sócio, Financeiro, Comercial, etc.) e clique 'Gerar Convite'.",acao:"Copie o link gerado e envie por WhatsApp ou e-mail."},
      {titulo:"Entenda os Níveis",desc:"Cada nível vê abas diferentes: Administrador vê tudo, Financeiro vê DRE/custos, Comercial vê vendas/preços, Operador vê apenas empresas atribuídas, Visualizador vê só o painel geral.",dica:"Vá em Admin → 'Mapa de Permissões' para ver o quadro completo."},
      {titulo:"Vincular Empresas",desc:"Após o usuário criar a conta, vá em Admin → 'Usuários', clique no nome dele e vincule as empresas que ele pode acessar. Use 'Vincular Todas' para dar acesso total.",acao:"Para operadores BPO, use o Dashboard BPO Supervisor para atribuir empresas específicas."},
    ]},

  // ═══ DADOS E INTEGRAÇÃO ═══
  { id:"t04", titulo:"Conectar ao Omie (ERP)", desc:"Importe dados financeiros automaticamente", icon:"🔗", cor:G, categoria:"Dados e Integração", duracao:"6 min", nivel:"intermediário",
    steps:[
      {titulo:"Obtenha as Credenciais do Omie",desc:"No Omie, vá em Configurações → API → Aplicações. Copie a App Key e o App Secret. Se não encontrar, peça ao suporte do Omie.",dica:"Cada empresa (CNPJ) tem credenciais diferentes no Omie."},
      {titulo:"Configure no PS Gestão",desc:"No Dashboard, clique em '📊 Dados' → selecione a empresa → preencha App Key e App Secret do Omie.",acao:"Clique 'Salvar' e depois 'Testar Conexão' para verificar."},
      {titulo:"Importar Dados",desc:"Após conectar, clique em 'Importar Dados'. O sistema puxará: contas a pagar, contas a receber, clientes e categorias. Isso pode levar 1-2 minutos.",dica:"A importação pode ser feita novamente a qualquer momento para atualizar os dados."},
      {titulo:"Verificar no Dashboard",desc:"Volte ao Dashboard → aba 'Resultado'. Os dados reais do Omie aparecerão no DRE e Mapa de Custos. O ícone 'demo' desaparece quando há dados reais.",acao:"Filtre por período usando os campos de data no topo."},
    ]},
  { id:"t05", titulo:"Preencher Contexto da Empresa", desc:"Alimente a IA com informações estratégicas", icon:"🧠", cor:GOL, categoria:"Dados e Integração", duracao:"5 min", nivel:"intermediário",
    steps:[
      {titulo:"Acesse Entrada de Dados",desc:"No Dashboard, clique em '📊 Dados' → role até a seção 'Painel de Contexto Humano'.",acao:"Este é o campo mais importante do sistema — é o que torna a IA personalizada."},
      {titulo:"Descreva a Empresa",desc:"Escreva tudo que a IA precisa saber: setor, porte, concorrentes, desafios, oportunidades, metas, sazonalidade, problemas atuais.",dica:"Quanto mais contexto, mais precisa a análise IA. Exemplo: 'Empresa de materiais elétricos, 18 funcionários, forte concorrência de grandes redes, inadimplência alta com PF.'"},
      {titulo:"Salve e Veja o Resultado",desc:"Clique 'Salvar Contexto'. Agora, na aba 'Resultado', os cards 🔴🟡🟢 da Análise IA vão cruzar os dados financeiros com o contexto que você escreveu.",acao:"Atualize o contexto sempre que a situação da empresa mudar."},
    ]},

  // ═══ ANÁLISE E RELATÓRIOS ═══
  { id:"t06", titulo:"Entender a Análise IA Automática", desc:"Cards 🔴🟡🟢 na aba Resultado", icon:"🤖", cor:R, categoria:"Análise e Relatórios", duracao:"4 min", nivel:"iniciante",
    steps:[
      {titulo:"Onde Encontrar",desc:"Vá ao Dashboard → aba 'Resultado'. Abaixo do DRE e do Mapa de Custos, você verá a seção 'PS — Consultor Digital' com os cards coloridos.",acao:"Os cards são gerados AUTOMATICAMENTE sempre que você muda o período ou a empresa."},
      {titulo:"Entenda os Cards",desc:"🔴 CRÍTICO: problema urgente que precisa de ação imediata (ex: resultado negativo, inadimplência alta). 🟡 ATENÇÃO: situação que merece monitoramento (ex: margem abaixo da meta). 🟢 OPORTUNIDADE: algo positivo que pode ser capitalizado (ex: receita em crescimento).",dica:"Clique em qualquer card para expandir e ver: Ação Recomendada + Impacto Estimado em R$."},
      {titulo:"Como a IA Decide",desc:"A IA cruza 3 fontes: 1) Dados financeiros reais (DRE, custos), 2) Contexto da empresa (que você escreveu), 3) Comparação com período anterior. Por isso, quanto mais dados e contexto, melhor a análise.",acao:"Mude o período no filtro de datas e veja os cards se atualizarem automaticamente."},
    ]},
  { id:"t07", titulo:"Fale com o PS (Chat IA)", desc:"Faça perguntas e receba análise personalizada", icon:"💬", cor:T, categoria:"Análise e Relatórios", duracao:"3 min", nivel:"iniciante",
    steps:[
      {titulo:"Abra o Chat",desc:"No Dashboard → aba 'Relatório' (ou 'Geral'), procure a seção 'Fale com o PS — Seu Consultor Digital'.",acao:"O campo de texto permite digitar qualquer pergunta ou cenário."},
      {titulo:"Faça Perguntas Estratégicas",desc:"Exemplos: 'Devo demitir 3 pessoas para cortar custos?', 'Vale a pena abrir filial em outra cidade?', 'O fornecedor aumentou 20%, devo trocar?'. A IA cruza com seus dados financeiros reais.",dica:"Seja específico. Quanto mais contexto na pergunta, melhor a resposta."},
      {titulo:"Use o Resultado",desc:"A resposta inclui análise com números reais da sua empresa, recomendação e riscos. Você pode copiar e compartilhar com sócios.",acao:"Copie clicando no botão 'Copiar' ao lado da resposta."},
    ]},

  // ═══ BPO ═══
  { id:"t08", titulo:"Módulo BPO — Visão Geral", desc:"Gerencie múltiplas empresas como BPO", icon:"📊", cor:G, categoria:"BPO Financeiro", duracao:"5 min", nivel:"intermediário",
    steps:[
      {titulo:"Acesse o BPO",desc:"No Dashboard, clique no botão '📊 BPO' (visível para Admin e Sócio). Você verá a lista de todas as empresas clientes com status de saúde financeira.",acao:"Cada empresa mostra: receita, margem, alertas e status (saudável/atenção/crítico)."},
      {titulo:"Dashboard do Supervisor",desc:"Clique em '👥 Supervisor' para acessar o painel do supervisor BPO. Aqui você vê: todas as empresas, operadores responsáveis e atribuições.",acao:"Atribua empresas a operadores — cada operador só verá as empresas atribuídas a ele."},
      {titulo:"Rotinas Automatizáveis",desc:"Clique em '🤖 Rotinas & Automação' para ver as 14 rotinas que podem ser automatizadas: conciliação, classificação, fechamento, etc.",dica:"Cada rotina mostra: frequência, tempo manual vs. automático e economia estimada."},
      {titulo:"Conciliação de Cartão",desc:"Clique em '💳 Conciliação Cartão'. Faça upload do CSV da operadora (Cielo, Stone, Rede, etc.) e o sistema concilia automaticamente com o ERP.",acao:"Use o CSV Demo para testar antes de usar dados reais."},
    ]},
  { id:"t09", titulo:"Atribuir Empresas a Operadores", desc:"Configurar quem vê o quê no BPO", icon:"🔗", cor:P, categoria:"BPO Financeiro", duracao:"3 min", nivel:"intermediário",
    steps:[
      {titulo:"Acesse o Supervisor",desc:"BPO → '👥 Supervisor' → aba 'Atribuições'.",acao:"Selecione o operador e a empresa, depois clique 'Atribuir'."},
      {titulo:"O que Muda para o Operador",desc:"O operador com role 'Operacional' só verá no dashboard as empresas atribuídas a ele. Não verá as outras empresas nem o painel Admin.",dica:"Isso é essencial para BPOs com múltiplos clientes — cada operador foca nos seus clientes."},
      {titulo:"Remover Atribuição",desc:"Na mesma tela, clique 'Remover' ao lado da atribuição para desvincular uma empresa do operador.",acao:"O operador perde acesso imediatamente."},
    ]},

  // ═══ MÓDULOS AVANÇADOS ═══
  { id:"t10", titulo:"Conciliação de Cartão de Crédito", desc:"Upload CSV → conciliação automática", icon:"💳", cor:Y, categoria:"Módulos Avançados", duracao:"4 min", nivel:"intermediário",
    steps:[
      {titulo:"Exporte o Extrato da Operadora",desc:"No portal da Cielo, Stone, Rede, PagSeguro ou GetNet, exporte o extrato de vendas em formato CSV.",dica:"Cada operadora tem um menu diferente. Geralmente está em Relatórios → Vendas → Exportar CSV."},
      {titulo:"Faça Upload",desc:"No PS Gestão → BPO → 💳 Conciliação Cartão, arraste o arquivo CSV na área indicada ou clique para selecionar.",acao:"O sistema detecta automaticamente a operadora pelo formato do CSV."},
      {titulo:"Veja o Resultado",desc:"Em segundos, o sistema mostra: ✅ Conciliado, ⚠️ Divergência, ❌ Não encontrado, 🔄 Chargeback. Clique em cada linha para ver detalhes.",dica:"A barra de progresso mostra a % de conciliação. Abaixo, a análise IA alerta sobre taxas acima do mercado."},
    ]},
  { id:"t11", titulo:"Módulo Viabilidade de Projetos", desc:"Upload de arquivo → IA analisa viabilidade", icon:"📐", cor:P, categoria:"Módulos Avançados", duracao:"4 min", nivel:"avançado",
    steps:[
      {titulo:"Acesse o Módulo",desc:"No header, clique em '📐 Viabilidade'. Você pode fazer upload de um arquivo (planilha, PDF, orçamento) ou descrever o projeto manualmente.",acao:"Arraste o arquivo na área de upload ou clique '✏️ Descrever Projeto Manualmente'."},
      {titulo:"Descreva o Projeto",desc:"Selecione o setor (Comércio, Indústria, Serviços, etc.) e descreva o projeto em detalhes: investimento, receita esperada, prazo, recursos necessários.",dica:"Quanto mais detalhes, melhor a análise. Inclua valores em R$ sempre que possível."},
      {titulo:"Receba a Análise",desc:"A IA retorna: ✅ Viável ou ❌ Inviável, com score (0-100), margem projetada, ROI, payback, pontos fortes, riscos e sugestões numeradas.",acao:"Use o botão 'Imprimir' para gerar um PDF da análise."},
    ]},

  // ═══ CONFIGURAÇÃO ═══
  { id:"t12", titulo:"Mapa de Permissões", desc:"Entenda cada nível de acesso", icon:"🔐", cor:GOL, categoria:"Configuração", duracao:"2 min", nivel:"iniciante",
    steps:[
      {titulo:"Acesse o Mapa",desc:"Admin → aba 'Mapa de Permissões'. Você verá os 7 níveis: Administrador, Sócio/CEO, Financeiro, Comercial, Operacional, Consultor e Visualizador.",acao:"Cada nível mostra quais abas o usuário pode acessar."},
      {titulo:"Escolha o Nível Certo",desc:"Administrador: acesso total + gestão de usuários. Sócio: acesso total sem gestão. Financeiro: DRE, custos, contas. Comercial: vendas, preços. Operador BPO: só empresas atribuídas. Visualizador: apenas painel geral.",dica:"Na dúvida, comece com 'Visualizador' e aumente conforme necessário."},
    ]},
  { id:"t13", titulo:"Gestão de Grupos de Empresas", desc:"Organize CNPJs em grupos", icon:"📁", cor:B, categoria:"Configuração", duracao:"3 min", nivel:"iniciante",
    steps:[
      {titulo:"Criar Grupo",desc:"Admin → aba 'Empresas' → '+ Grupo'. Dê um nome e escolha uma cor. Exemplo: 'Grupo Tryo Gessos' (laranja).",acao:"Cada grupo pode ter quantas empresas quiser."},
      {titulo:"Mover Empresa entre Grupos",desc:"Na lista de empresas, clique '↗️ Mover' ao lado da empresa e selecione o novo grupo. A mudança é imediata.",dica:"Empresas sem grupo aparecem na seção 'Sem Grupo' no final da lista."},
      {titulo:"Usar no Dashboard",desc:"No Dashboard, o seletor de empresas mostra: '📊 Todas' no topo, depois '📁 Grupo X (N empresas)' com as empresas dentro de cada grupo.",acao:"Selecione o grupo para ver dados consolidados apenas daquele grupo."},
    ]},
];

const categorias=["Primeiros Passos","Dados e Integração","Análise e Relatórios","BPO Financeiro","Módulos Avançados","Configuração"];
const catIcons:Record<string,string>={"Primeiros Passos":"🚀","Dados e Integração":"🔗","Análise e Relatórios":"📊","BPO Financeiro":"📋","Módulos Avançados":"⚡","Configuração":"⚙️"};
const nivelCor={iniciante:G,intermediário:Y,avançado:P};

export default function TutorialPage(){
  const [busca,setBusca]=useState("");
  const [catFiltro,setCatFiltro]=useState("todos");
  const [tutorialAberto,setTutorialAberto]=useState<string|null>(null);
  const [stepAtual,setStepAtual]=useState(0);
  const [completados,setCompletados]=useState<string[]>([]);

  // Load completed tutorials from localStorage
  useEffect(()=>{
    try{const saved=localStorage.getItem("ps_tutorials_done");if(saved)setCompletados(JSON.parse(saved));}catch{}
  },[]);

  const marcarCompleto=(id:string)=>{
    const updated=[...new Set([...completados,id])];
    setCompletados(updated);
    try{localStorage.setItem("ps_tutorials_done",JSON.stringify(updated));}catch{}
  };

  const filtered=tutoriais.filter(t=>{
    if(catFiltro!=="todos"&&t.categoria!==catFiltro)return false;
    if(busca){const s=busca.toLowerCase();return t.titulo.toLowerCase().includes(s)||t.desc.toLowerCase().includes(s)||t.steps.some(st=>st.titulo.toLowerCase().includes(s)||st.desc.toLowerCase().includes(s));}
    return true;
  });

  const totalCompleto=completados.length;
  const totalTutoriais=tutoriais.length;
  const pctCompleto=Math.round(totalCompleto/totalTutoriais*100);

  // Tutorial detail view
  if(tutorialAberto){
    const tut=tutoriais.find(t=>t.id===tutorialAberto);
    if(!tut)return null;
    const step=tut.steps[stepAtual];
    const isLast=stepAtual===tut.steps.length-1;
    const isDone=completados.includes(tut.id);

    return(
      <div style={{padding:20,maxWidth:700,margin:"0 auto",background:BG,minHeight:"100vh"}}>
        <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

        {/* Back */}
        <button onClick={()=>{setTutorialAberto(null);setStepAtual(0);}} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:11,marginBottom:16,cursor:"pointer"}}>← Voltar aos tutoriais</button>

        {/* Header */}
        <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${BD}`,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
            <span style={{fontSize:32}}>{tut.icon}</span>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:TX}}>{tut.titulo}</div>
              <div style={{fontSize:11,color:TXD}}>{tut.desc} · {tut.duracao} · <span style={{color:nivelCor[tut.nivel]}}>{tut.nivel}</span></div>
            </div>
          </div>

          {/* Progress */}
          <div style={{display:"flex",gap:4,marginBottom:8}}>
            {tut.steps.map((_,i)=>(
              <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=stepAtual?tut.cor:BD,transition:"background 0.3s"}}/>
            ))}
          </div>
          <div style={{fontSize:10,color:TXD}}>Passo {stepAtual+1} de {tut.steps.length}</div>
        </div>

        {/* Step content */}
        <div key={stepAtual} style={{animation:"fadeIn 0.3s ease",background:BG2,borderRadius:14,padding:24,border:`1px solid ${BD}`,marginBottom:16}}>
          <div style={{fontSize:11,color:tut.cor,fontWeight:600,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Passo {stepAtual+1}</div>
          <div style={{fontSize:18,fontWeight:700,color:TX,marginBottom:12}}>{step.titulo}</div>
          <div style={{fontSize:13,color:TXM,lineHeight:1.8,marginBottom:16}}>{step.desc}</div>

          {step.acao&&(
            <div style={{padding:"12px 16px",borderRadius:10,background:`${tut.cor}10`,border:`1px solid ${tut.cor}25`,marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:tut.cor,letterSpacing:1,marginBottom:4}}>▸ AÇÃO</div>
              <div style={{fontSize:12,color:TX,lineHeight:1.6}}>{step.acao}</div>
            </div>
          )}

          {step.dica&&(
            <div style={{padding:"12px 16px",borderRadius:10,background:`${B}08`,border:`1px solid ${B}20`}}>
              <div style={{fontSize:10,fontWeight:700,color:B,letterSpacing:1,marginBottom:4}}>💡 DICA</div>
              <div style={{fontSize:12,color:TXM,lineHeight:1.6}}>{step.dica}</div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <button onClick={()=>setStepAtual(Math.max(0,stepAtual-1))} disabled={stepAtual===0} style={{
            padding:"10px 20px",borderRadius:10,border:`1px solid ${BD}`,background:"transparent",
            color:stepAtual===0?TXD:TX,fontSize:12,cursor:stepAtual===0?"default":"pointer",
          }}>← Anterior</button>

          {isLast?(
            <button onClick={()=>{marcarCompleto(tut.id);setTutorialAberto(null);setStepAtual(0);}} style={{
              padding:"10px 24px",borderRadius:10,border:"none",
              background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:700,cursor:"pointer",
            }}>{isDone?"✓ Já Concluído":"✓ Concluir Tutorial"}</button>
          ):(
            <button onClick={()=>setStepAtual(stepAtual+1)} style={{
              padding:"10px 20px",borderRadius:10,border:"none",
              background:tut.cor,color:BG,fontSize:12,fontWeight:600,cursor:"pointer",
            }}>Próximo →</button>
          )}
        </div>
      </div>
    );
  }

  // Main listing view
  return(
    <div style={{padding:20,maxWidth:1000,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>📚 Central de Ajuda & Tutoriais</div>
          <div style={{fontSize:11,color:TXD}}>Guias interativos passo a passo para dominar o PS Gestão</div>
        </div>
        <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
      </div>

      {/* Progress bar */}
      <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:12,color:TXM}}>Seu progresso</span>
          <span style={{fontSize:12,fontWeight:600,color:pctCompleto===100?G:GOL}}>{totalCompleto}/{totalTutoriais} tutoriais · {pctCompleto}%</span>
        </div>
        <div style={{height:8,borderRadius:4,background:BD,overflow:"hidden"}}>
          <div style={{width:`${pctCompleto}%`,height:"100%",borderRadius:4,background:`linear-gradient(90deg,${GO},${GOL})`,transition:"width 0.5s"}}/>
        </div>
      </div>

      {/* Search + filters */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar tutorial..." style={{
            width:"100%",padding:"10px 14px 10px 36px",background:BG2,border:`1px solid ${BD}`,borderRadius:10,color:TX,fontSize:13,outline:"none",
          }} onFocus={e=>{e.target.style.borderColor=GO;}} onBlur={e=>{e.target.style.borderColor=BD;}}/>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <div style={{display:"flex",gap:4,overflowX:"auto"}}>
          <button onClick={()=>setCatFiltro("todos")} style={{padding:"8px 14px",borderRadius:8,fontSize:11,whiteSpace:"nowrap",border:catFiltro==="todos"?`1px solid ${GO}50`:`1px solid ${BD}`,background:catFiltro==="todos"?`${GO}10`:"transparent",color:catFiltro==="todos"?GOL:TXM,fontWeight:catFiltro==="todos"?600:400,cursor:"pointer"}}>Todos</button>
          {categorias.map(c=>(
            <button key={c} onClick={()=>setCatFiltro(c)} style={{padding:"8px 14px",borderRadius:8,fontSize:11,whiteSpace:"nowrap",border:catFiltro===c?`1px solid ${GO}50`:`1px solid ${BD}`,background:catFiltro===c?`${GO}10`:"transparent",color:catFiltro===c?GOL:TXM,fontWeight:catFiltro===c?600:400,cursor:"pointer"}}>{catIcons[c]} {c}</button>
          ))}
        </div>
      </div>

      {/* Tutorials by category */}
      {(catFiltro==="todos"?categorias:[catFiltro]).map(cat=>{
        const catTuts=filtered.filter(t=>t.categoria===cat);
        if(catTuts.length===0)return null;
        return(
          <div key={cat} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{fontSize:16}}>{catIcons[cat]}</span>
              <span style={{fontSize:14,fontWeight:700,color:TX}}>{cat}</span>
              <span style={{fontSize:10,color:TXD}}>({catTuts.length})</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",gap:10}}>
              {catTuts.map(tut=>{
                const isDone=completados.includes(tut.id);
                return(
                  <div key={tut.id} onClick={()=>{setTutorialAberto(tut.id);setStepAtual(0);}} style={{
                    background:BG2,borderRadius:14,padding:"16px 18px",border:`1px solid ${isDone?G+"30":BD}`,
                    cursor:"pointer",transition:"all 0.2s",borderLeft:`3px solid ${isDone?G:tut.cor}`,
                  }} onMouseEnter={e=>{e.currentTarget.style.borderColor=tut.cor;e.currentTarget.style.transform="translateY(-2px)";}}
                     onMouseLeave={e=>{e.currentTarget.style.borderColor=isDone?G+"30":BD;e.currentTarget.style.transform="";}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:22}}>{tut.icon}</span>
                        <div>
                          <div style={{fontSize:13,fontWeight:600,color:TX}}>{tut.titulo}</div>
                          <div style={{fontSize:10,color:TXD,marginTop:2}}>{tut.duracao} · <span style={{color:nivelCor[tut.nivel]}}>{tut.nivel}</span></div>
                        </div>
                      </div>
                      {isDone&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:G+"15",color:G,fontWeight:600,border:`1px solid ${G}30`}}>✓ Feito</span>}
                    </div>
                    <div style={{fontSize:11,color:TXM,lineHeight:1.5}}>{tut.desc}</div>
                    <div style={{fontSize:10,color:TXD,marginTop:8}}>{tut.steps.length} passos</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:40,color:TXD,fontSize:13}}>Nenhum tutorial encontrado para "{busca}"</div>
      )}
    </div>
  );
}
