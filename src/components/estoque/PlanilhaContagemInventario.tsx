'use client'

// Estoque › aba Inventário (já existe — RD-26): planilha de contagem.
//   BaixarPlanilhaContagemModal — filtros (local, grupo/categoria, só com saldo) + contagem cega → .xlsx A4.
//   SubirContagemModal — lê a planilha preenchida, mostra a PRÉVIA das diferenças contra o saldo atual e só então
//   cria o inventário com as contagens (pelo caminho oficial: erp_inventarios + fn_inventario_registrar_contagem).
//   O estoque NÃO é ajustado aqui: o ajuste é o "Fechar inventário" do drawer, com a confirmação que já existe.

import { useEffect, useMemo, useState } from 'react'
import { X, Download, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { selecionarTodas } from '@/lib/selecionarTodas'
import {
  gerarPlanilhaContagem, lerPlanilhaContagem, montarPrevia, type Previa, type ProdutoAtual,
} from '@/lib/estoque/planilhaContagem'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoL: '#9C8E80', offWhite: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', borderL: '#EDE7DA', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#10B981', greenBg: '#ECFDF5', red: '#EF4444', redBg: '#FEE2E2', amber: '#C88A1A', amberBg: '#FFF8E1',
}
const inp: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.white, color: C.espresso, width: '100%', marginTop: 4 }
const lbl: React.CSSProperties = { fontSize: 11, color: C.espressoM, fontWeight: 600 }
const btnSec: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.espresso, fontSize: 12, fontWeight: 500, cursor: 'pointer' }
const btnPri = (on: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: 'none', background: on ? C.gold : C.cream, color: on ? '#FFF' : C.espressoL,
  fontSize: 12, fontWeight: 600, cursor: on ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6,
})
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtR = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type LocalMin = { id: string; nome: string; principal: boolean | null }
type ProdutoPlanilha = ProdutoAtual & { codigo_barras: string | null; localizacao: string | null; categoria: string | null; grupo: string | null }

const COLS = 'id,codigo,codigo_barras,nome,unidade,localizacao,categoria,grupo,estoque_atual,preco_custo_medio,preco_custo'
const grupoDe = (p: { categoria: string | null; grupo: string | null }) => (p.categoria || p.grupo || '').trim()

/** Universo de produtos ativos da empresa (todas as páginas — teto de 1000 do PostgREST, #126). */
function useProdutosAtivos(companyId: string) {
  const [produtos, setProdutos] = useState<ProdutoPlanilha[] | null>(null)
  const [lidoEm, setLidoEm] = useState<Date>(new Date())
  useEffect(() => {
    let vivo = true
    void (async () => {
      const { data } = await selecionarTodas<ProdutoPlanilha>((de, ate) => supabase.from('erp_produtos').select(COLS)
        .eq('company_id', companyId).eq('ativo', true).order('nome').order('id').range(de, ate))
      if (!vivo) return
      setProdutos((data ?? []) as ProdutoPlanilha[])
      setLidoEm(new Date())
    })()
    return () => { vivo = false }
  }, [companyId])
  return { produtos, lidoEm }
}

function Moldura({ titulo, largura, onClose, bloqueado, children }: { titulo: string; largura: number; onClose: () => void; bloqueado?: boolean; children: React.ReactNode }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !bloqueado) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}
        style={{ background: C.offWhite, borderRadius: 12, padding: 22, width: '100%', maxWidth: largura, maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${C.border}`, color: C.espresso }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{titulo}</h3>
          <button onClick={onClose} disabled={bloqueado} aria-label="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.espressoM }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────── ida: baixar ───────────────────────────

export function BaixarPlanilhaContagemModal({ companyId, empresa, cnpj, locais, onClose, flashErr }: {
  companyId: string; empresa: string; cnpj?: string | null; locais: LocalMin[]; onClose: () => void; flashErr: (m: string) => void
}) {
  const principal = locais.find((l) => l.principal) ?? locais[0] ?? null
  const [localId, setLocalId] = useState(principal?.id ?? '')
  const [grupo, setGrupo] = useState('')
  const [soComSaldo, setSoComSaldo] = useState(true)
  const [cega, setCega] = useState(true)
  const [gerando, setGerando] = useState(false)
  const { produtos, lidoEm } = useProdutosAtivos(companyId)

  const grupos = useMemo(() => Array.from(new Set((produtos ?? []).map(grupoDe).filter(Boolean))).sort(), [produtos])
  const lista = useMemo(() => (produtos ?? []).filter((p) =>
    (!soComSaldo || Number(p.estoque_atual ?? 0) > 0) && (!grupo || grupoDe(p) === grupo)), [produtos, soComSaldo, grupo])

  async function baixar() {
    const local = locais.find((l) => l.id === localId)
    if (!local) { flashErr('Escolha o local.'); return }
    setGerando(true)
    try {
      const filtros = [grupo && `Grupo: ${grupo}`, soComSaldo ? 'só itens com saldo' : 'todos os itens ativos'].filter(Boolean).join(' · ')
      const bytes = await gerarPlanilhaContagem({
        empresa, cnpj, local: local.nome, saldoEm: lidoEm, filtros, cega,
        produtos: lista.map((p) => ({ id: p.id, codigo: p.codigo, codigo_barras: p.codigo_barras, nome: p.nome, unidade: p.unidade, localizacao: p.localizacao, estoque_atual: p.estoque_atual })),
      })
      const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const d = lidoEm
      const carimbo = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
      a.download = `contagem_inventario_${local.nome.replace(/[^\p{L}\p{N}]+/gu, '_')}_${carimbo}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      onClose()
    } catch (e) {
      flashErr('Não foi possível gerar a planilha: ' + ((e as Error)?.message ?? ''))
    } finally {
      setGerando(false)
    }
  }

  return (
    <Moldura titulo="📥 Baixar planilha de contagem" largura={520} onClose={onClose} bloqueado={gerando}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={lbl}>Local *</label>
          <select value={localId} onChange={(e) => setLocalId(e.target.value)} style={inp} data-testid="contagem-local">
            {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Grupo / categoria</label>
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} style={inp} data-testid="contagem-grupo" disabled={grupos.length === 0}>
            <option value="">{grupos.length ? 'Todos' : 'Todos (produtos sem grupo cadastrado)'}</option>
            {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={lbl}>Só itens com saldo</label>
            <select value={soComSaldo ? 'sim' : 'nao'} onChange={(e) => setSoComSaldo(e.target.value === 'sim')} style={inp} data-testid="contagem-so-saldo">
              <option value="sim">Sim</option>
              <option value="nao">Não (todos os ativos)</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Contagem cega</label>
            <select value={cega ? 'sim' : 'nao'} onChange={(e) => setCega(e.target.value === 'sim')} style={inp} data-testid="contagem-cega">
              <option value="sim">Sim — esconde o saldo do sistema</option>
              <option value="nao">Não — mostra saldo e diferença</option>
            </select>
          </div>
        </div>
        <div style={{ padding: 10, background: C.goldBg, borderRadius: 8, fontSize: 12, color: C.goldD }} data-testid="contagem-resumo">
          {produtos == null ? 'Carregando produtos…' : <>A planilha vai sair com <strong>{lista.length}</strong> item(ns), saldo de {lidoEm.toLocaleString('pt-BR')}.
            {cega && ' Contagem cega: quem conta não vê o saldo do sistema.'}</>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <button type="button" onClick={onClose} disabled={gerando} style={btnSec}>Cancelar</button>
          <button type="button" onClick={baixar} disabled={gerando || produtos == null || lista.length === 0 || !localId}
            data-testid="contagem-baixar" style={btnPri(!gerando && produtos != null && lista.length > 0 && !!localId)}>
            <Download size={14} /> {gerando ? 'Gerando…' : 'Baixar .xlsx'}
          </button>
        </div>
      </div>
    </Moldura>
  )
}

// ─────────────────────────── volta: subir + prévia ───────────────────────────

export function SubirContagemModal({ companyId, locais, onClose, onCriado, flashErr }: {
  companyId: string; locais: LocalMin[]; onClose: () => void; onCriado: (inventarioId: string) => void | Promise<void>; flashErr: (m: string) => void
}) {
  const principal = locais.find((l) => l.principal) ?? locais[0] ?? null
  const [localId, setLocalId] = useState(principal?.id ?? '')
  const [arquivo, setArquivo] = useState<string>('')
  const [lendo, setLendo] = useState(false)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [emBranco, setEmBranco] = useState(0)
  const [so, setSo] = useState<'diferencas' | 'todos'>('diferencas')
  const [criando, setCriando] = useState<string>('')
  const { produtos } = useProdutosAtivos(companyId)

  async function ler(f: File) {
    if (!produtos) return
    setLendo(true); setPrevia(null); setArquivo(f.name)
    try {
      const leitura = await lerPlanilhaContagem(await f.arrayBuffer())
      setEmBranco(leitura.emBranco)
      setPrevia(montarPrevia(leitura, produtos))
    } catch (e) {
      flashErr('Não foi possível ler a planilha: ' + ((e as Error)?.message ?? 'arquivo inválido'))
    } finally {
      setLendo(false)
    }
  }

  async function criar() {
    if (!previa || previa.itens.length === 0 || !localId) return
    setCriando('Criando o inventário…')
    try {
      const { data: numero } = await supabase.rpc('next_inventario_numero', { p_company_id: companyId })
      const { data: { session } } = await supabase.auth.getSession(); const user = session?.user
      const { data: inv, error: e1 } = await supabase.from('erp_inventarios').insert({
        company_id: companyId,
        numero: numero ?? `INV-${Date.now().toString().slice(-6)}`,
        local_id: localId,
        status: 'em_andamento',
        data_inicio: new Date().toISOString().slice(0, 10),
        responsavel: user?.email ?? null,
        total_produtos: previa.itens.length,
        observacoes: `Contagem importada da planilha ${arquivo}`,
        created_by: user?.id ?? null,
      }).select('id').single()
      if (e1 || !inv) throw new Error(e1?.message ?? 'Falha ao criar inventário')
      const { data: itens, error: e2 } = await supabase.from('erp_inventario_itens').insert(previa.itens.map((i) => ({
        inventario_id: inv.id, company_id: companyId, produto_id: i.produto_id,
        quantidade_sistema: i.sistema, custo_unitario: i.custo, observacoes: i.observacao || null,
      }))).select('id,produto_id')
      if (e2 || !itens) throw new Error(e2?.message ?? 'Falha ao gravar os itens')
      // contagens pelo caminho oficial (mesma RPC da digitação no drawer: valor da diferença + totais do inventário)
      const contado = new Map(previa.itens.map((i) => [i.produto_id, i.contado]))
      const fila = [...(itens as { id: string; produto_id: string }[])]
      let feitos = 0
      const erros: string[] = []
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let it = fila.shift(); it; it = fila.shift()) {
          const { error } = await supabase.rpc('fn_inventario_registrar_contagem', {
            p_item_id: it.id, p_quantidade_contada: contado.get(it.produto_id) ?? 0, p_usuario: user?.email ?? null,
          })
          if (error) erros.push(error.message)
          feitos++
          setCriando(`Registrando contagens… ${feitos}/${itens.length}`)
        }
      }))
      if (erros.length) throw new Error(`${erros.length} contagem(ns) não gravaram (${erros[0]}). O inventário ficou aberto, sem ajustar o estoque.`)
      await onCriado(inv.id)
    } catch (e) {
      flashErr((e as Error)?.message ?? 'Erro ao criar o inventário')
    } finally {
      setCriando('')
    }
  }

  const visiveis = previa ? (so === 'diferencas' ? previa.itens.filter((i) => i.diferenca !== 0) : previa.itens) : []

  return (
    <Moldura titulo="📤 Subir contagem (planilha preenchida)" largura={860} onClose={onClose} bloqueado={!!criando}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <div>
            <label style={lbl}>Local do inventário *</label>
            <select value={localId} onChange={(e) => setLocalId(e.target.value)} style={inp} disabled={!!criando}>
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Planilha de contagem (.xlsx)</label>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-testid="contagem-arquivo"
              disabled={!produtos || lendo || !!criando} style={{ ...inp, padding: 6 }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); e.target.value = '' }} />
          </div>
        </div>
        {!produtos && <div style={{ fontSize: 12, color: C.espressoM }}>Carregando produtos…</div>}
        {lendo && <div style={{ fontSize: 12, color: C.espressoM }}>Lendo a planilha…</div>}

        {previa && (
          <>
            <div data-testid="contagem-previa-resumo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {[
                ['Contados', String(previa.totais.contados), C.espresso],
                ['Sem diferença', String(previa.totais.iguais), C.espressoM],
                ['Sobras', `${previa.totais.sobras} · ${fmtR(previa.totais.valor_sobras)}`, C.green],
                ['Faltas', `${previa.totais.faltas} · ${fmtR(previa.totais.valor_faltas)}`, C.red],
              ].map(([t, v, cor]) => (
                <div key={t} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: C.espressoM, textTransform: 'uppercase', fontWeight: 700 }}>{t}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: cor }}>{v}</div>
                </div>
              ))}
            </div>
            {emBranco > 0 && <div style={{ fontSize: 12, color: C.espressoM }}>{emBranco} linha(s) com a quantidade em branco ficaram de fora (não contadas).</div>}
            {previa.erros.length > 0 && (
              <div data-testid="contagem-previa-erros" style={{ padding: 10, background: C.redBg, borderRadius: 8, fontSize: 12, color: C.red }}>
                <strong>{previa.erros.length} linha(s) não entram:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {previa.erros.slice(0, 12).map((e, i) => <li key={i}>{e.linha ? `Linha ${e.linha}: ` : ''}{e.mensagem}</li>)}
                  {previa.erros.length > 12 && <li>… e mais {previa.erros.length - 12}.</li>}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
              <span style={{ color: C.espressoM }}>Mostrar:</span>
              <select value={so} onChange={(e) => setSo(e.target.value as 'diferencas' | 'todos')} style={{ ...inp, width: 'auto', marginTop: 0 }}>
                <option value="diferencas">Só com diferença</option>
                <option value="todos">Todos os contados</option>
              </select>
            </div>
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'auto', maxHeight: '42vh' }}>
              <table data-testid="contagem-previa" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
                <thead style={{ background: C.cream, position: 'sticky', top: 0 }}>
                  <tr>
                    {['Código', 'Descrição', 'Sistema (agora)', 'Contado', 'Diferença', 'Valor'].map((h, i) => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: i >= 2 ? 'right' : 'left', fontSize: 10, textTransform: 'uppercase', color: C.espressoM }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length === 0 && <tr><td colSpan={6} style={{ padding: 14, textAlign: 'center', color: C.espressoM }}>Nenhuma diferença: tudo o que foi contado bate com o sistema.</td></tr>}
                  {visiveis.map((i) => {
                    const cor = i.diferenca > 0 ? C.green : i.diferenca < 0 ? C.red : C.espressoL
                    return (
                      <tr key={i.produto_id} data-testid="contagem-previa-linha" style={{ borderTop: `1px solid ${C.borderL}` }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{i.codigo || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>{i.descricao}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmtQ(i.sistema)} {i.unidade}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtQ(i.contado)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: cor }}>{i.diferenca > 0 ? '+' : ''}{fmtQ(i.diferenca)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: cor }}>{fmtR(i.valor_diferenca)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 10, background: C.amberBg, borderRadius: 8, fontSize: 12, color: C.goldD }}>
              Nada foi gravado ainda. <strong>Criar inventário</strong> registra estas contagens num inventário aberto —
              o estoque <strong>não muda</strong>. O ajuste só acontece quando alguém clicar em <strong>Fechar inventário</strong> e confirmar.
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          {criando && <span style={{ fontSize: 12, color: C.espressoM, marginRight: 'auto' }}>{criando}</span>}
          <button type="button" onClick={onClose} disabled={!!criando} style={btnSec}>Cancelar</button>
          <button type="button" onClick={criar} disabled={!previa || previa.itens.length === 0 || !!criando || !localId}
            data-testid="contagem-criar" style={btnPri(!!previa && previa.itens.length > 0 && !criando && !!localId)}>
            <Upload size={14} /> Criar inventário com {previa?.itens.length ?? 0} contagem(ns)
          </button>
        </div>
      </div>
    </Moldura>
  )
}
