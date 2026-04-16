'use client'
import React from 'react'
import Link from 'next/link'

const C={bg:'#0F0F0F',card:'#1A1410',card2:'#1E1E1B',border:'#2A2822',gold:'#C8941A',goldL:'#E8C872',text:'#FAF7F2',muted:'#B0AB9F',dim:'#918C82'}

export default function TermosPage(){
  return(
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'Helvetica',sans-serif"}}>
      {/* Header */}
      <header style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:'16px 24px',position:'sticky',top:0,zIndex:10}}>
        <div style={{maxWidth:900,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <Link href="/" style={{display:'flex',alignItems:'center',gap:12,textDecoration:'none',color:C.gold}}>
            <div style={{fontSize:24,fontWeight:900,letterSpacing:'0.05em'}}>PS<span style={{color:C.goldL}}>G</span></div>
            <div style={{fontSize:10,letterSpacing:'0.2em',color:C.goldL}}>PS GESTÃO &amp; CAPITAL</div>
          </Link>
          <Link href="/" style={{color:C.muted,fontSize:12,textDecoration:'none'}}>← Voltar</Link>
        </div>
      </header>

      <div style={{maxWidth:900,margin:'0 auto',padding:'40px 24px'}}>
        {/* Title */}
        <div style={{textAlign:'center',marginBottom:40,paddingBottom:24,borderBottom:`2px solid ${C.gold}`}}>
          <div style={{fontSize:11,letterSpacing:'0.3em',color:C.gold,marginBottom:10}}>PLATAFORMA ERP PS GESTÃO</div>
          <h1 style={{fontSize:32,fontWeight:700,color:C.goldL,margin:'0 0 8px'}}>Termos de Uso</h1>
          <div style={{fontSize:11,color:C.dim,marginTop:10}}>
            Data de publicação: 04/04/2026 · Última atualização: 15/04/2026 · Versão 1.1
          </div>
        </div>

        <div style={{fontSize:13,lineHeight:1.8,color:C.text}}>
          <Section n="1" titulo="OBJETO">
            <p>Estes Termos de Uso (&quot;Termos&quot;) regulam o acesso e a utilização da plataforma ERP PS Gestão (&quot;Plataforma&quot;), desenvolvida e mantida pela <strong>PS Gestão e Capital LTDA</strong> (&quot;PS GESTÃO&quot;), CNPJ <strong>60.866.510/0001-78</strong>, com sede em São Miguel do Oeste/SC.</p>
            <p>A Plataforma é um sistema de Gestão Empresarial (ERP) em modelo SaaS (Software as a Service) com integração de Inteligência Artificial, destinado à gestão financeira, BPO Financeiro automatizado, geração de relatórios gerenciais e análise de dados empresariais.</p>
            <p>Ao acessar ou utilizar a Plataforma, o usuário (&quot;USUÁRIO&quot;) declara que leu, compreendeu e concorda integralmente com estes Termos e com a <Link href="/privacidade" style={{color:C.gold,textDecoration:'underline'}}>Política de Privacidade</Link> da PS GESTÃO.</p>
          </Section>

          <Section n="2" titulo="CADASTRO E ACESSO">
            <Sub titulo="2.1 Requisitos">
              <p>O acesso à Plataforma é restrito a usuários devidamente cadastrados e autorizados. O cadastro é realizado mediante convite do administrador da empresa contratante ou diretamente pela PS GESTÃO.</p>
            </Sub>
            <Sub titulo="2.2 Responsabilidade do Usuário">
              <p>O USUÁRIO é integralmente responsável pela guarda e confidencialidade de suas credenciais de acesso (e-mail e senha). Qualquer atividade realizada com as credenciais do USUÁRIO será de sua exclusiva responsabilidade.</p>
            </Sub>
            <Sub titulo="2.3 Níveis de Acesso">
              <p>A Plataforma opera com sistema de permissões por nível hierárquico, incluindo mas não se limitando a: administrador, sócio, diretor, financeiro, operador BPO, supervisor, consultor e visualizador. Cada nível possui acesso restrito aos módulos e funcionalidades autorizados pelo administrador da conta.</p>
            </Sub>
          </Section>

          <Section n="3" titulo="SERVIÇOS DISPONIBILIZADOS">
            <Sub titulo="3.1 Módulos da Plataforma">
              <p>A Plataforma disponibiliza os seguintes módulos, conforme o plano contratado:</p>
              <ModCard titulo="ERP Financeiro" desc="Visão diária, DRE, fluxo de caixa, balanço patrimonial, contas a pagar/receber, orçamento, rateio por linha de negócio."/>
              <ModCard titulo="BPO Financeiro Inteligente" desc="9 módulos automatizados (anomalias, cobrança, fluxo de caixa, DRE mensal, fechamento, obrigações fiscais, indicadores, resumo IA), com retroalimentação automática."/>
              <ModCard titulo="Anti-Fraude" desc="Sistema patenteado de 11 camadas com score de 0 a 100, integrado ao BPO."/>
              <ModCard titulo="Consultor IA" desc="Análise de documentos e geração de relatórios gerenciais com Inteligência Artificial."/>
              <ModCard titulo="Módulo Industrial" desc="Custo industrial, ficha técnica, mapa de custos (disponível nos planos Industrial e superiores)."/>
              <ModCard titulo="Módulo Wealth" desc="Gestão patrimonial, MFO (disponível no plano PS Wealth)."/>
            </Sub>
            <Sub titulo="3.2 Inteligência Artificial">
              <p>A Plataforma utiliza sistemas de IA para análise e classificação automática de dados financeiros. O USUÁRIO reconhece e concorda que:</p>
              <ItemLista letra="a">As sugestões da IA são recomendações automáticas e <strong>NÃO substituem a análise humana profissional</strong>;</ItemLista>
              <ItemLista letra="b">A aprovação ou rejeição de classificações sugeridas pela IA é de responsabilidade exclusiva do USUÁRIO;</ItemLista>
              <ItemLista letra="c">A PS GESTÃO não se responsabiliza por decisões empresariais tomadas com base exclusiva nas análises geradas pela IA;</ItemLista>
              <ItemLista letra="d">Os dados financeiros são processados por provedores terceiros de IA (Anthropic), conforme descrito na <Link href="/privacidade" style={{color:C.gold,textDecoration:'underline'}}>Política de Privacidade</Link>.</ItemLista>
            </Sub>
          </Section>

          <Section n="4" titulo="PLANOS E PAGAMENTO">
            <Sub titulo="4.1 Planos Disponíveis">
              <p>A Plataforma opera em modelo de assinatura mensal (SaaS), com os seguintes planos:</p>
              <PlanoTable/>
            </Sub>
            <Sub titulo="4.2 Faturamento">
              <p>O faturamento é mensal, com vencimento conforme data de contratação. O não pagamento por período superior a 30 (trinta) dias poderá resultar em suspensão do acesso à Plataforma, sem prejuízo dos dados armazenados pelo período de 90 (noventa) dias.</p>
            </Sub>
          </Section>

          <Section n="5" titulo="PROPRIEDADE INTELECTUAL">
            <p>A Plataforma, incluindo mas não se limitando ao código-fonte, design, interface, algoritmos de IA, sistema anti-fraude (11 camadas), metodologia de BPO automatizado e respectivas patentes registradas no INPI, são de propriedade exclusiva da PS GESTÃO.</p>
            <p>O USUÁRIO recebe uma licença de uso não exclusiva, intransferível e revogável para utilização da Plataforma durante a vigência do contrato, não adquirindo nenhum direito sobre o código-fonte, algoritmos ou propriedade intelectual da PS GESTÃO.</p>
            <div style={{background:C.card,borderLeft:`4px solid ${C.gold}`,padding:'14px 18px',margin:'14px 0',borderRadius:6}}>
              <strong style={{color:C.gold}}>É expressamente proibido:</strong> copiar, modificar, distribuir, vender, sublicenciar, descompilar, realizar engenharia reversa ou qualquer forma de extração do código-fonte ou algoritmos da Plataforma.
            </div>
          </Section>

          <Section n="6" titulo="OBRIGAÇÕES DO USUÁRIO">
            <p>O USUÁRIO se obriga a:</p>
            <ItemLista letra="a">Fornecer informações verdadeiras, completas e atualizadas no cadastro;</ItemLista>
            <ItemLista letra="b">Manter a confidencialidade de suas credenciais de acesso;</ItemLista>
            <ItemLista letra="c">Utilizar a Plataforma exclusivamente para fins lícitos e em conformidade com a legislação aplicável;</ItemLista>
            <ItemLista letra="d">Não utilizar a Plataforma para armazenar, processar ou transmitir dados ilícitos, difamatórios ou que violem direitos de terceiros;</ItemLista>
            <ItemLista letra="e">Não tentar acessar dados de outras empresas ou usuários não autorizados;</ItemLista>
            <ItemLista letra="f">Comunicar imediatamente à PS GESTÃO qualquer uso não autorizado de sua conta ou qualquer violação de segurança;</ItemLista>
            <ItemLista letra="g">Verificar e aprovar as classificações sugeridas pela IA antes de aplicá-las definitivamente;</ItemLista>
            <ItemLista letra="h">Manter backup próprio dos dados críticos de sua empresa.</ItemLista>
          </Section>

          <Section n="7" titulo="LIMITAÇÃO DE RESPONSABILIDADE">
            <p>A PS GESTÃO não será responsável por:</p>
            <ItemLista letra="a">Danos decorrentes de interrupções temporárias no serviço por motivos de manutenção, atualização ou força maior;</ItemLista>
            <ItemLista letra="b">Erros em classificações sugeridas pela IA que tenham sido aprovadas pelo USUÁRIO sem a devida verificação;</ItemLista>
            <ItemLista letra="c">Decisões empresariais tomadas com base exclusiva nos relatórios e análises gerados pela Plataforma;</ItemLista>
            <ItemLista letra="d">Dados incorretos, incompletos ou desatualizados fornecidos pelo USUÁRIO ou importados de sistemas de terceiros (Omie, Nibo, ContaAzul);</ItemLista>
            <ItemLista letra="e">Acesso não autorizado decorrente de negligência do USUÁRIO na guarda de suas credenciais;</ItemLista>
            <ItemLista letra="f">Indisponibilidade dos serviços de terceiros integrados (APIs do Omie, Nibo, ContaAzul, Anthropic);</ItemLista>
            <ItemLista letra="g">Danos indiretos, lucros cessantes, perda de dados ou danos morais, na máxima extensão permitida pela legislação aplicável.</ItemLista>
            <div style={{background:C.card2,borderRadius:8,padding:'14px 18px',margin:'14px 0',border:`1px solid ${C.gold}40`}}>
              A responsabilidade total da PS GESTÃO, em qualquer hipótese, será limitada ao valor pago pelo USUÁRIO nos últimos 12 (doze) meses de serviço.
            </div>
          </Section>

          <Section n="8" titulo="DISPONIBILIDADE E SLA">
            <p>A PS GESTÃO emprega seus melhores esforços para manter a Plataforma disponível 24 horas por dia, 7 dias por semana, com meta de disponibilidade de <strong>99,5% ao mês</strong>. Manutenções programadas serão comunicadas com antecedência mínima de 24 (vinte e quatro) horas, preferencialmente realizadas em horários de baixo uso.</p>
          </Section>

          <Section n="9" titulo="RESCISÃO">
            <Sub titulo="9.1 Pelo Usuário">
              <p>O USUÁRIO pode solicitar o cancelamento de sua conta a qualquer tempo, mediante comunicação escrita com 30 (trinta) dias de antecedência. Após o cancelamento, os dados serão mantidos por 90 (noventa) dias para eventual exportação, sendo eliminados após esse período, salvo obrigação legal de retenção.</p>
            </Sub>
            <Sub titulo="9.2 Pela PS GESTÃO">
              <p>A PS GESTÃO poderá suspender ou cancelar o acesso do USUÁRIO em caso de: violação destes Termos, uso fraudulento ou ilícito da Plataforma, inadimplência superior a 30 (trinta) dias, ou por decisão judicial.</p>
            </Sub>
          </Section>

          <Section n="10" titulo="DISPOSIÇÕES GERAIS">
            <Sub titulo="10.1 Alterações">
              <p>A PS GESTÃO reserva-se o direito de alterar estes Termos a qualquer tempo. Alterações substanciais serão comunicadas com antecedência mínima de 15 (quinze) dias. O uso continuado da Plataforma após a notificação constitui aceitação dos novos Termos.</p>
            </Sub>
            <Sub titulo="10.2 Legislação Aplicável">
              <p>Estes Termos são regidos pela legislação da República Federativa do Brasil, em especial pela Lei nº 13.709/2018 (LGPD), Lei nº 12.965/2014 (Marco Civil da Internet), Lei nº 8.078/1990 (CDC) e Lei nº 10.406/2002 (Código Civil).</p>
            </Sub>
            <Sub titulo="10.3 Foro">
              <p>Fica eleito o Foro da Comarca de São Miguel do Oeste, Estado de Santa Catarina, para dirimir quaisquer questões oriundas destes Termos, com renúncia expressa a qualquer outro, por mais privilegiado que seja.</p>
            </Sub>
            <Sub titulo="10.4 Independência das Cláusulas">
              <p>A eventual invalidade ou inexequibilidade de qualquer cláusula destes Termos não afetará a validade das demais cláusulas, que permanecerão em pleno vigor e efeito.</p>
            </Sub>
          </Section>
        </div>

        <footer style={{marginTop:40,paddingTop:24,borderTop:`1px solid ${C.border}`,textAlign:'center',fontSize:10,color:C.dim}}>
          PS Gestão e Capital LTDA · CNPJ 60.866.510/0001-78 · São Miguel do Oeste/SC<br/>
          <Link href="/privacidade" style={{color:C.gold,textDecoration:'none',margin:'0 8px'}}>Política de Privacidade</Link>·
          <a href="mailto:paravizi-salvi@gpconsultoriadeinvestimentos.com" style={{color:C.gold,textDecoration:'none',marginLeft:8}}>Contato DPO</a>
        </footer>
      </div>
    </div>
  )
}

function Section({n,titulo,children}:{n:string;titulo:string;children:React.ReactNode}){
  return(
    <section style={{marginBottom:32}}>
      <h2 style={{fontSize:18,fontWeight:700,color:C.gold,margin:'24px 0 14px',paddingBottom:8,borderBottom:`1px solid ${C.border}`}}>
        <span style={{color:C.goldL,marginRight:10}}>{n}.</span>{titulo}
      </h2>
      {children}
    </section>
  )
}

function Sub({titulo,children}:{titulo:string;children:React.ReactNode}){
  return(
    <div style={{marginBottom:16}}>
      <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,margin:'18px 0 8px'}}>{titulo}</h3>
      {children}
    </div>
  )
}

function ItemLista({letra,children}:{letra:string;children:React.ReactNode}){
  return(
    <p style={{marginLeft:20,position:'relative',padding:'4px 0'}}>
      <span style={{color:C.gold,fontWeight:700,marginRight:8}}>{letra})</span>{children}
    </p>
  )
}

function ModCard({titulo,desc}:{titulo:string;desc:string}){
  return(
    <div style={{background:C.card,borderRadius:8,padding:'12px 16px',margin:'8px 0',borderLeft:`3px solid ${C.gold}`}}>
      <div style={{fontSize:13,fontWeight:700,color:C.goldL,marginBottom:4}}>{titulo}</div>
      <div style={{fontSize:12,color:C.muted}}>{desc}</div>
    </div>
  )
}

function PlanoTable(){
  const rows=[
    {nome:'ERP Comércio & Serviço',valor:'R$ 297 a R$ 497/mês',cor:'#3B82F6'},
    {nome:'BPO Financeiro',valor:'R$ 997 a R$ 2.497/mês',cor:'#22C55E'},
    {nome:'Industrial',valor:'R$ 1.497 a R$ 4.997/mês',cor:'#F59E0B'},
    {nome:'Assessoria Empresarial',valor:'R$ 2.997 a R$ 9.997/mês',cor:'#8B5CF6'},
    {nome:'PS Wealth MFO',valor:'R$ 2.000 a R$ 200.000/mês',cor:C.gold},
  ]
  return(
    <div style={{margin:'14px 0'}}>
      {rows.map((r,i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:C.card,marginBottom:6,borderRadius:6,borderLeft:`4px solid ${r.cor}`}}>
          <span style={{fontWeight:600,color:C.text}}>{r.nome}</span>
          <span style={{color:r.cor,fontWeight:600,fontSize:12}}>{r.valor}</span>
        </div>
      ))}
    </div>
  )
}
