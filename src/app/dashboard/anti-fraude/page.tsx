'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', card2: '#201C16', bd: '#2A2822', go: '#C8941A', gol: '#E8C872', tx: '#FAF7F2', txm: '#B0AB9F', txd: '#706C64', g: '#22C55E', r: '#EF4444', y: '#FBBF24', b: '#60A5FA', tl: '#2DD4BF', p: '#A855F7' }

const STATUS_EXCL = new Set(['CANCELADO','CANCELADA','ESTORNADO','ESTORNADA','DEVOLVIDO','DEVOLVIDA','ANULADO','ANULADA'])

interface Lanc { id: string; data: string; desc: string; valor: number; cat: string; forn: string; codForn: string; tipo: string; nfe: string; nossoNum: string; codBarras: string; banco: string; score: number; flags: string[] }

function extract(imports: any[]): { lancs: Lanc[]; fornCadastrados: Set<string>; fornHistorico: Record<string, number[]>; fornPrimeiro: Record<string, string> } {
  const lancs: Lanc[] = []
  const nomes: Record<string, string> = {}
  const fornCadastrados = new Set<string>()
  const fornHistorico: Record<string, number[]> = {}
  const fornPrimeiro: Record<string, string> = {}
  let idx = 0

  // Build name map + fornecedor registry
  for (const imp of imports) {
    if (imp.import_type === 'clientes') {
      const cls = imp.import_data?.clientes_cadastro || []
      if (Array.isArray(cls)) for (const c of cls) {
        const cod = String(c.codigo_cliente_omie || c.codigo_cliente || c.codigo || '')
        nomes[cod] = c.nome_fantasia || c.razao_social || c.nome || ''
        fornCadastrados.add(cod)
      }
    }
  }

  for (const imp of imports) {
    if (imp.import_type === 'contas_pagar') {
      const regs = imp.import_data?.conta_pagar_cadastro || []
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0; if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || '')
        const dataE = r.data_emissao || r.data_vencimento || ''

        // Track historical values per supplier
        if (!fornHistorico[codCF]) fornHistorico[codCF] = []
        fornHistorico[codCF].push(v)
        if (!fornPrimeiro[codCF] || dataE < fornPrimeiro[codCF]) fornPrimeiro[codCF] = dataE

        lancs.push({
          id: 'P' + (idx++),
          data: dataE,
          desc: r.observacao || r.descricao_categoria || '',
          valor: -v,
          cat: r.descricao_categoria || r.codigo_categoria || '',
          forn: nomes[codCF] || r.observacao || 'Fornecedor ' + codCF,
          codForn: codCF,
          tipo: 'despesa',
          nfe: r.numero_documento_fiscal || r.nsu || '',
          nossoNum: r.numero_pedido || r.numero_documento || '',
          codBarras: r.codigo_barras_ficha_compensacao || '',
          banco: r.codigo_tipo_documento || '',
          score: 100,
          flags: [],
        })
      }
    }
    if (imp.import_type === 'contas_receber') {
      const regs = imp.import_data?.conta_receber_cadastro || []
      if (!Array.isArray(regs)) continue
      for (const r of regs) {
        const st = (r.status_titulo || '').toUpperCase().trim()
        if (STATUS_EXCL.has(st)) continue
        const v = Number(r.valor_documento) || 0; if (v <= 0) continue
        const codCF = String(r.codigo_cliente_fornecedor || '')
        lancs.push({
          id: 'R' + (idx++),
          data: r.data_emissao || r.data_vencimento || '',
          desc: r.observacao || r.descricao_categoria || '',
          valor: v,
          cat: r.descricao_categoria || r.codigo_categoria || '',
          forn: nomes[codCF] || 'Cliente ' + codCF,
          codForn: codCF,
          tipo: 'receita',
          nfe: r.numero_documento_fiscal || '',
          nossoNum: r.numero_pedido || '',
          codBarras: '',
          banco: '',
          score: 100,
          flags: [],
        })
      }
    }
  }
  return { lancs: lancs.sort((a, b) => (b.data || '').localeCompare(a.data || '')), fornCadastrados, fornHistorico, fornPrimeiro }
}

function runDetection(lancs: Lanc[], fornCad: Set<string>, fornHist: Record<string, number[]>, fornPrim: Record<string, string>) {
  const despesas = lancs.filter(l => l.tipo === 'despesa')
  const vals = despesas.map(l => Math.abs(l.valor)).filter(v => v > 0)
  const media = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0

  for (const l of despesas) {
    const v = Math.abs(l.valor)
    let penalty = 0

    // 1. Fornecedor cadastrado?
    if (l.codForn && !fornCad.has(l.codForn)) {
      l.flags.push('Fornecedor NAO cadastrado no ERP')
      penalty += 25
    }

    // 2. Valor dentro da faixa historica?
    const hist = fornHist[l.codForn]
    if (hist && hist.length >= 3) {
      const avgForn = hist.reduce((s, x) => s + x, 0) / hist.length
      if (v > avgForn * 2.5) {
        l.flags.push('Valor ' + (v / avgForn).toFixed(1) + 'x acima da media do fornecedor')
        penalty += 15
      }
    }

    // 3. Tempo de relacionamento
    const prim = fornPrim[l.codForn]
    if (prim) {
      const diff = Math.abs(new Date(l.data || '2026-01-01').getTime() - new Date(prim).getTime())
      const dias = diff / (1000 * 60 * 60 * 24)
      if (dias < 30) {
        l.flags.push('Fornecedor com menos de 30 dias de relacionamento')
        penalty += 10
      }
    }

    // 4. NF-e vinculada?
    if (!l.nfe || l.nfe.trim() === '' || l.nfe === '0') {
      if (v > 1000) {
        l.flags.push('Sem NF-e vinculada (valor > R$1K)')
        penalty += 12
      }
    }

    // 5. Nosso Numero / Pedido valido?
    if (!l.nossoNum || l.nossoNum.trim() === '' || l.nossoNum === '0') {
      if (v > 5000) {
        l.flags.push('Sem numero de pedido/documento')
        penalty += 8
      }
    }

    // 6. Valor redondo suspeito
    if (v >= 10000 && v % 1000 === 0) {
      l.flags.push('Valor redondo suspeito (R$ ' + v.toLocaleString('pt-BR') + ')')
      penalty += 10
    }

    // 7. Duplicata potencial
    const dupes = despesas.filter(d => d.id !== l.id && Math.abs(Math.abs(d.valor) - v) < 0.01 && d.data === l.data)
    if (dupes.length > 0) {
      l.flags.push('Possivel duplicata (' + (dupes.length + 1) + ' lancamentos iguais)')
      penalty += 20
    }

    // 8. CNPJ padrao suspeito (via codForn)
    const cod = parseInt(l.codForn || '0')
    if (cod > 0 && cod < 100) {
      l.flags.push('Codigo fornecedor muito baixo (possivel cadastro generico)')
      penalty += 5
    }

    // 9. Outlier (3x media geral)
    if (v > media * 3 && v > 5000) {
      l.flags.push('Valor atipico: ' + (v / media).toFixed(1) + 'x acima da media geral')
      penalty += 15
    }

    // 10. Lancamento em fim de semana
    if (l.data) {
      const d = new Date(l.data.includes('/') ? l.data.split('/').reverse().join('-') : l.data)
      if (d.getDay() === 0 || d.getDay() === 6) {
        l.flags.push('Lancamento em fim de semana')
        penalty += 5
      }
    }

    // 11. Sem descricao
    if (!l.desc || l.desc.trim().length < 3) {
      l.flags.push('Sem descricao adequada')
      penalty += 5
    }

    l.score = Math.max(0, 100 - penalty)
  }

  return lancs
}

export default function AntiFraudePage() {
  const [empresas, setEmpresas] = useState<any[]>([])
  const [grupos, setGrupos] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [lancs, setLancs] = useState<Lanc[]>([])
  const [loading, setLoading] = useState(false)
  const [analisado, setAnalisado] = useState(false)
  const [filtroScore, setFiltroScore] = useState<'todos' | 'critico' | 'suspeito' | 'atencao' | 'seguro'>('todos')
  const [expandido, setExpandido] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: up } = await supabase.from('users').select('role').eq('id', user.id).single()
      let comps: any[] = []
      if (up?.role === 'adm' || up?.role === 'acesso_total') {
        const { data } = await supabase.from('companies').select('id, nome_fantasia, razao_social, group_id').order('nome_fantasia')
        comps = (data || []).map(c => ({ id: c.id, nome: c.nome_fantasia || c.razao_social, group_id: c.group_id }))
        const { data: grps } = await supabase.from('company_groups').select('*').order('nome')
        setGrupos(grps || [])
      } else {
        const { data: uc } = await supabase.from('user_companies').select('companies(id, nome_fantasia, razao_social, group_id)').eq('user_id', user.id)
        comps = (uc || []).map((u: any) => u.companies).filter(Boolean).map((c: any) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social, group_id: c.group_id }))
      }
      setEmpresas(comps)
      if (comps.length === 1) setEmpresaSel(comps[0].id)
      else if (comps.length > 1) setEmpresaSel('consolidado')
    })()
  }, [])

  const analisar = useCallback(async () => {
    if (!empresaSel) return
    setLoading(true); setAnalisado(false)
    const compIds = empresaSel === 'consolidado' ? empresas.map(c => c.id) :
      empresaSel.startsWith('group_') ? empresas.filter(c => c.group_id === empresaSel.replace('group_', '')).map(c => c.id) :
      [empresaSel]
    let allImports: any[] = []
    for (const cid of compIds) {
      const { data } = await supabase.from('omie_imports').select('import_type, import_data').eq('company_id', cid)
      if (data) allImports.push(...data)
    }
    const { lancs: raw, fornCadastrados, fornHistorico, fornPrimeiro } = extract(allImports)
    const scored = runDetection(raw, fornCadastrados, fornHistorico, fornPrimeiro)
    setLancs(scored)
    setLoading(false)
    setAnalisado(true)
  }, [empresaSel, empresas])

  const despesas = lancs.filter(l => l.tipo === 'despesa')
  const filtradas = filtroScore === 'todos' ? despesas :
    filtroScore === 'critico' ? despesas.filter(l => l.score < 30) :
    filtroScore === 'suspeito' ? despesas.filter(l => l.score >= 30 && l.score < 60) :
    filtroScore === 'atencao' ? despesas.filter(l => l.score >= 60 && l.score < 80) :
    despesas.filter(l => l.score >= 80)

  const stats = {
    total: despesas.length,
    critico: despesas.filter(l => l.score < 30).length,
    suspeito: despesas.filter(l => l.score >= 30 && l.score < 60).length,
    atencao: despesas.filter(l => l.score >= 60 && l.score < 80).length,
    seguro: despesas.filter(l => l.score >= 80).length,
    valorRisco: despesas.filter(l => l.score < 60).reduce((s, l) => s + Math.abs(l.valor), 0),
    scoreMedia: despesas.length > 0 ? Math.round(despesas.reduce((s, l) => s + l.score, 0) / despesas.length) : 0,
  }

  const scoreColor = (s: number) => s >= 80 ? C.g : s >= 60 ? C.y : s >= 30 ? '#F97316' : C.r
  const fmt = (v: number) => 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

  return (
    <div style={{ padding: '16px 16px 40px', minHeight: '100vh', background: C.bg, color: C.tx }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 9, color: C.r, letterSpacing: 2, textTransform: 'uppercase' }}>Motor Proprietario</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.tx, margin: '2px 0 0' }}>Anti-Fraude — 11 Camadas</h1>
          <div style={{ fontSize: 11, color: C.txd }}>Score 0-100 por pagamento | Dados reais do Omie | Patente INPI</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={empresaSel} onChange={e => { setEmpresaSel(e.target.value); setAnalisado(false) }} style={{ background: C.card, border: '1px solid ' + C.bd, color: C.tx, padding: '8px 12px', borderRadius: 6, fontSize: 12, maxWidth: 250 }}>
            <option value="">Selecione empresa</option>
            {empresas.length > 1 && <option value="consolidado">📊 Todas ({empresas.length})</option>}
            {grupos.map(g => {
              const emps = empresas.filter(c => c.group_id === g.id)
              if (emps.length === 0) return null
              return (
                <optgroup key={g.id} label={'📁 ' + g.nome}>
                  <option value={'group_' + g.id}>📁 {g.nome} (grupo)</option>
                  {emps.map(e => <option key={e.id} value={e.id}>└ {e.nome}</option>)}
                </optgroup>
              )
            })}
            {empresas.filter(c => !c.group_id || !grupos.find(g => g.id === c.group_id)).map(e => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
          <button onClick={analisar} disabled={loading || !empresaSel} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: loading ? C.bd : C.r, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            {loading ? 'Analisando...' : 'Executar Anti-Fraude'}
          </button>
        </div>
      </div>

      {/* 11 CAMADAS */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
        {['Fornecedor cadastrado', 'Faixa historica', 'Tempo relacionamento', 'NF-e vinculada', 'Pedido/Documento', 'Valor redondo', 'Duplicatas', 'CNPJ suspeito', 'Outlier', 'Fim de semana', 'Sem descricao'].map((cam, i) => (
          <span key={i} style={{ fontSize: 8, padding: '3px 8px', borderRadius: 4, background: C.r + '15', color: C.r, fontWeight: 600, border: '1px solid ' + C.r + '30' }}>{(i + 1).toString().padStart(2, '0')} {cam}</span>
        ))}
      </div>

      {analisado && (
        <>
          {/* SCORECARD */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6, marginBottom: 14 }}>
            {[
              { l: 'Score Medio', v: String(stats.scoreMedia), c: scoreColor(stats.scoreMedia) },
              { l: 'Total Despesas', v: String(stats.total), c: C.b },
              { l: 'Critico (<30)', v: String(stats.critico), c: C.r },
              { l: 'Suspeito (30-59)', v: String(stats.suspeito), c: '#F97316' },
              { l: 'Atencao (60-79)', v: String(stats.atencao), c: C.y },
              { l: 'Seguro (80+)', v: String(stats.seguro), c: C.g },
              { l: 'Valor em Risco', v: fmt(stats.valorRisco), c: C.r },
            ].map((k, i) => (
              <div key={i} style={{ background: C.card, borderRadius: 7, padding: '8px 10px', borderLeft: '3px solid ' + k.c }}>
                <div style={{ fontSize: 7, color: C.txd, textTransform: 'uppercase', letterSpacing: 0.3 }}>{k.l}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.c, marginTop: 1 }}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* FILTROS */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {([['todos', 'Todos (' + stats.total + ')', C.b], ['critico', 'Critico (' + stats.critico + ')', C.r], ['suspeito', 'Suspeito (' + stats.suspeito + ')', '#F97316'], ['atencao', 'Atencao (' + stats.atencao + ')', C.y], ['seguro', 'Seguro (' + stats.seguro + ')', C.g]] as const).map(([k, label, cor]) => (
              <button key={k} onClick={() => setFiltroScore(k)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: filtroScore === k ? '1px solid ' + cor : '1px solid ' + C.bd, background: filtroScore === k ? cor + '15' : 'transparent', color: filtroScore === k ? cor : C.txm }}>{label}</button>
            ))}
          </div>

          {/* TABELA */}
          <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden', border: '1px solid ' + C.bd }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + C.bd }}>
                  {['Score', 'Data', 'Fornecedor', 'Descricao', 'Valor', 'Flags'].map(h => (
                    <th key={h} style={{ padding: '8px 6px', textAlign: h === 'Valor' ? 'right' : 'left', color: C.go, fontSize: 9, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtradas.slice(0, 50).map(l => (
                  <React.Fragment key={l.id}>
                    <tr onClick={() => setExpandido(expandido === l.id ? null : l.id)} style={{ borderBottom: '0.5px solid ' + C.bd + '40', cursor: l.flags.length > 0 ? 'pointer' : 'default', background: expandido === l.id ? C.card2 : 'transparent' }}>
                      <td style={{ padding: '6px', width: 55 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(l.score), padding: '2px 8px', borderRadius: 4, background: scoreColor(l.score) + '15' }}>{l.score}</span>
                      </td>
                      <td style={{ padding: '6px', fontSize: 10, color: C.txm, whiteSpace: 'nowrap' }}>{l.data}</td>
                      <td style={{ padding: '6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.forn}</td>
                      <td style={{ padding: '6px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', color: C.txm }}>{l.desc}</td>
                      <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600, color: C.r }}>{fmt(l.valor)}</td>
                      <td style={{ padding: '6px' }}>
                        {l.flags.length > 0 && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: scoreColor(l.score) + '15', color: scoreColor(l.score), fontWeight: 600 }}>{l.flags.length} flag{l.flags.length > 1 ? 's' : ''}</span>}
                      </td>
                    </tr>
                    {expandido === l.id && l.flags.length > 0 && (
                      <tr><td colSpan={6} style={{ padding: '4px 6px 10px 60px', background: C.card2 }}>
                        {l.flags.map((f, i) => (
                          <div key={i} style={{ fontSize: 10, color: scoreColor(l.score), padding: '2px 0', borderLeft: '2px solid ' + scoreColor(l.score), paddingLeft: 8, marginBottom: 2 }}>{f}</div>
                        ))}
                        <div style={{ fontSize: 9, color: C.txd, marginTop: 4 }}>Cat: {l.cat || 'N/I'} | NF-e: {l.nfe || 'Sem'} | Doc: {l.nossoNum || 'Sem'} | Cod.Forn: {l.codForn}</div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {filtradas.length > 50 && <div style={{ padding: 10, textAlign: 'center', fontSize: 10, color: C.txd }}>Mostrando 50 de {filtradas.length} lancamentos</div>}
            {filtradas.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: C.txm }}>Nenhum lancamento com esse filtro</div>}
          </div>

          <div style={{ fontSize: 8, color: C.txd, textAlign: 'center', marginTop: 16 }}>PS Gestao e Capital — Motor Anti-Fraude v2.0 | 11 Camadas | Score 0-100 | Patente INPI</div>
        </>
      )}

      {!analisado && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: C.txm }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🛡️</div>
          <div style={{ fontSize: 14 }}>Selecione uma empresa e clique Executar Anti-Fraude</div>
          <div style={{ fontSize: 11, color: C.txd, marginTop: 6 }}>11 camadas de verificacao | Score 0-100 por pagamento | Dados reais do Omie</div>
        </div>
      )}
    </div>
  )
}
