'use client'

// Abastecimento de Dados — HUB-índice de uploads de planilha (sistemas SEM API).
// NÃO tem lógica de parse: só lista as fontes em cards e ROTEIA pras telas/rotas
// que já existem (RD-26 — consolida, não recria). Espelha /conexoes-bancarias
// (que lista bancos-API), mas pra arquivos. Prioridade é sempre API; planilha é fallback.
import Link from 'next/link'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

type Fonte = { icone: string; titulo: string; descricao: string; rota: string; badge: string; badgeCor: string; pronto: boolean }
const FONTES: Fonte[] = [
  { icone: '📋', titulo: 'Folha de Pagamento (Domínio)', descricao: 'Sobe o "Encargos da Empresa" (.xls) e apura custo por verba/competência.', rota: '/dashboard/industrial/folha', badge: 'Pronto', badgeCor: '#16A34A', pronto: true },
  { icone: '💰', titulo: 'Lançamentos Financeiros', descricao: 'Planilha de contas a pagar/receber (SIGA, Excel, CSV) → financeiro.', rota: '/dashboard/importar-universal', badge: 'Pronto', badgeCor: '#16A34A', pronto: true },
  { icone: '📦', titulo: 'Produtos / Fiscal', descricao: 'Cadastro de produtos por planilha (NCM, preço, fiscal).', rota: '/dashboard/cadastros/produtos', badge: 'Pronto', badgeCor: '#16A34A', pronto: true },
  { icone: '🏭', titulo: 'Abate / Produção (ATAK)', descricao: 'Dados de abate do ATAK (SQL Server sem API pública) — via carga.', rota: '', badge: 'Em breve', badgeCor: '#2563EB', pronto: false },
  { icone: '🏦', titulo: 'Extrato Bancário (planilha)', descricao: 'Extrato em Excel/OFX quando não há Open Finance.', rota: '/dashboard/financeiro/conexoes-bancarias', badge: 'Parcial', badgeCor: '#C8941A', pronto: true },
]

export default function AbastecimentoPage() {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD }}>Dados</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 0' }}>📤 Abastecimento de Dados</h1>
          <p style={{ fontSize: 13, color: MUT, margin: '6px 0 0', maxWidth: 640 }}>
            Suba planilhas de sistemas <b>sem API</b> (folha, abate, legados). A prioridade é sempre integração por API —
            <Link href="/dashboard/financeiro/conexoes-bancarias" style={{ color: GOLD, textDecoration: 'none' }}> Conexões Bancárias</Link> e
            <Link href="/dashboard/conectores" style={{ color: GOLD, textDecoration: 'none' }}> Conectores</Link>. A planilha é o caminho para os legados.
          </p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {FONTES.map((f) => {
            const inner = (
              <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, height: '100%', opacity: f.pronto ? 1 : 0.65 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 26 }}>{f.icone}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: f.badgeCor + '18', color: f.badgeCor, textTransform: 'uppercase', letterSpacing: 0.5 }}>{f.badge}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 10 }}>{f.titulo}</div>
                <div style={{ fontSize: 12, color: MUT, marginTop: 4, lineHeight: 1.4 }}>{f.descricao}</div>
                <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: f.pronto ? GOLD : MUT }}>{f.pronto ? 'Abrir →' : 'Em breve'}</div>
              </div>
            )
            return f.pronto && f.rota
              ? <Link key={f.titulo} href={f.rota} style={{ textDecoration: 'none' }}>{inner}</Link>
              : <div key={f.titulo}>{inner}</div>
          })}
        </div>

        <div style={{ fontSize: 11, color: MUT, marginTop: 18, background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '10px 14px' }}>
          🔒 Dados sensíveis (folha/salário) ficam com acesso por empresa (RLS). Os indicadores/BI expõem só agregado por setor — sem dado individual.
        </div>
      </div>
    </div>
  )
}
