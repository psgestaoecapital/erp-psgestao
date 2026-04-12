'use client'

import React, { useState } from 'react'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', blue: '#42A5F5' }

interface FAQ { pergunta: string; resposta: string; categoria: string }

const FAQS: FAQ[] = [
  { categoria: 'Inicio', pergunta: 'Como comecar a usar o ERP?', resposta: 'Apos o login, acesse a Visao Diaria para ter um panorama geral. Cadastre sua empresa em Admin e comece importando seus dados financeiros pelo modulo Importar (CSV ou OFX).' },
  { categoria: 'Inicio', pergunta: 'Como cadastrar uma empresa?', resposta: 'Acesse o modulo Admin, clique em "Nova Empresa" e preencha os dados: nome, CNPJ, regime tributario e linhas de negocio. A empresa ficara disponivel em todos os modulos.' },
  { categoria: 'Dados', pergunta: 'Como importar meus dados financeiros?', resposta: 'Use o modulo Importar. Ele aceita arquivos CSV (separados por virgula ou ponto-e-virgula) e OFX (extrato bancario). O sistema detecta automaticamente as colunas e permite mapear antes de importar.' },
  { categoria: 'Dados', pergunta: 'Posso importar extrato bancario OFX?', resposta: 'Sim! O modulo Importar reconhece o formato OFX automaticamente. Basta selecionar o arquivo do seu banco e o sistema extrai data, descricao, valor e tipo de cada transacao.' },
  { categoria: 'Analise', pergunta: 'O que e a Curva ABC?', resposta: 'A Curva ABC classifica seus clientes, fornecedores ou categorias em 3 faixas: A (80% do valor, poucos itens), B (15% do valor) e C (5% do valor, muitos itens). Ajuda a focar no que mais impacta o resultado.' },
  { categoria: 'Analise', pergunta: 'Como funciona o Anti-Fraude?', resposta: 'O modulo Anti-Fraude analisa seus lancamentos buscando: duplicatas exatas, valores redondos suspeitos acima de R$10K, lancamentos em fins de semana, registros sem descricao, valores repetidos e outliers (acima de 3x a media).' },
  { categoria: 'Analise', pergunta: 'O que e o modulo Custo?', resposta: 'O modulo Custo organiza suas despesas em 13 grupos padrao (Materia-Prima, Embalagens, Mao de Obra, etc.) e compara o realizado com o orcado, mostrando semaforos de variacao.' },
  { categoria: 'Custos', pergunta: 'Como funciona o Rateio?', resposta: 'O Rateio distribui custos indiretos (aluguel, energia, administrativo) entre linhas de negocio ou centros de custo usando criterios como faturamento, area ou headcount.' },
  { categoria: 'Custos', pergunta: 'O que e Ficha Tecnica?', resposta: 'A Ficha Tecnica detalha a composicao de custo de cada produto ou servico: materiais, mao de obra, overhead. Essencial para precificacao correta e analise de margem.' },
  { categoria: 'Gestao', pergunta: 'Como usar o Orcamento?', resposta: 'O modulo Orcamento permite criar previsoes mensais por categoria. O sistema compara automaticamente com o realizado, mostrando variacao percentual e semaforos.' },
  { categoria: 'Gestao', pergunta: 'O que e o Consultor IA?', resposta: 'O Consultor IA e um assistente inteligente que analisa seus dados financeiros e gera insights automaticos: alertas criticos, pontos de atencao e oportunidades. Usa inteligencia artificial para interpretar seus numeros.' },
  { categoria: 'Gestao', pergunta: 'O que aparece na Visao Diaria?', resposta: 'A Visao Diaria (Dashboard) mostra um resumo executivo: receitas e despesas do periodo, saldo, principais indicadores, e alertas do Consultor IA. E a tela inicial do sistema.' },
  { categoria: 'Industrial', pergunta: 'O modulo Industrial e para que?', resposta: 'O modulo Industrial e voltado para frigorificos e industrias alimenticias. Inclui: OEE (eficiencia de equipamentos), controle de rendimento e perdas, UEP (unidade de esforco de producao) e KPIs industriais por setor.' },
  { categoria: 'Assessor', pergunta: 'O que e o PS Assessor?', resposta: 'O PS Assessor e uma plataforma white-label para assessorias empresariais. Permite que assessores facam diagnosticos inteligentes dos clientes, criem planos de acao monitorados e acompanhem resultados via dashboard.' },
  { categoria: 'Assessor', pergunta: 'Posso personalizar o PS Assessor com minha marca?', resposta: 'Sim! O PS Assessor suporta white-label: voce configura logo, cores e nome da sua assessoria. Seus clientes veem a sua marca, nao a PS Gestao.' },
  { categoria: 'Wealth', pergunta: 'O que e o PS Wealth?', resposta: 'O PS Wealth e uma plataforma de Multi Family Office (MFO). Gerencia portfolios de investimento de multiplos clientes com visao de alocacao por classe de ativo, AUM total e performance.' },
  { categoria: 'Suporte', pergunta: 'Como reportar um problema?', resposta: 'Entre em contato pelo email suporte@psgestao.com.br ou pelo WhatsApp da PS Gestao. Descreva o problema com detalhes: qual modulo, o que estava fazendo, e se possivel uma captura de tela.' },
  { categoria: 'Suporte', pergunta: 'O sistema e seguro?', resposta: 'Sim. O ERP usa autenticacao Supabase com tokens JWT, todas as APIs sao protegidas, dados trafegam via HTTPS, e o sistema segue diretrizes LGPD. Seus dados financeiros sao criptografados.' },
]

const CATEGORIAS = ['Todos', ...Array.from(new Set(FAQS.map(f => f.categoria)))]

export default function AjudaPage() {
  const [busca, setBusca] = useState('')
  const [catSel, setCatSel] = useState('Todos')
  const [aberto, setAberto] = useState<number | null>(null)

  const filtered = FAQS.filter(f => {
    const matchCat = catSel === 'Todos' || f.categoria === catSel
    const matchBusca = !busca || f.pergunta.toLowerCase().includes(busca.toLowerCase()) || f.resposta.toLowerCase().includes(busca.toLowerCase())
    return matchCat && matchBusca
  })

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, marginBottom: 4 }}>Central de Ajuda</h1>
      <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Perguntas frequentes sobre o ERP PS Gestao</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          type="text" placeholder="Buscar pergunta..."
          value={busca} onChange={e => setBusca(e.target.value)}
          style={{ background: C.card, border: '1px solid ' + C.border, color: C.text, padding: '10px 14px', borderRadius: 6, fontSize: 13, flex: 1, minWidth: 200 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {CATEGORIAS.map(cat => (
          <button key={cat} onClick={() => setCatSel(cat)} style={{
            padding: '6px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: catSel === cat ? C.gold : C.card,
            color: catSel === cat ? '#3D2314' : C.muted,
          }}>{cat}</button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</div>

      {filtered.map((faq, i) => {
        const isOpen = aberto === i
        return (
          <div key={i} style={{ background: C.card, borderRadius: 8, marginBottom: 8, overflow: 'hidden', borderLeft: '3px solid ' + (isOpen ? C.gold : C.border) }}>
            <button onClick={() => setAberto(isOpen ? null : i)} style={{
              width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', color: C.text,
              textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <span style={{ fontSize: 10, color: C.gold, fontWeight: 600, marginRight: 8, textTransform: 'uppercase' }}>{faq.categoria}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{faq.pergunta}</span>
              </div>
              <span style={{ fontSize: 18, color: C.gold, flexShrink: 0, marginLeft: 8 }}>{isOpen ? '-' : '+'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: '0 16px 14px', fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                {faq.resposta}
              </div>
            )}
          </div>
        )
      })}

      {filtered.length === 0 && (
        <div style={{ background: C.card, borderRadius: 8, padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: C.muted }}>Nenhuma pergunta encontrada. Tente outra busca.</div>
        </div>
      )}

      <div style={{ background: C.card, borderRadius: 8, padding: 16, marginTop: 20, borderLeft: '3px solid ' + C.blue }}>
        <div style={{ fontWeight: 700, color: C.blue, marginBottom: 8 }}>Precisa de mais ajuda?</div>
        <div style={{ fontSize: 13, color: C.muted }}>
          Entre em contato: suporte@psgestao.com.br
        </div>
      </div>
    </div>
  )
}