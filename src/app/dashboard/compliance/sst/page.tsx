// src/app/dashboard/compliance/sst/page.tsx
// SST · LTCAT — passo 1: importar os setores do ponto para prod_setor (base da cadeia
// setor → posto/função → risco/EPI). Genérico por tenant. Prévia antes de importar (não em
// silêncio): mostra os setores do ponto, marca os que já existem, deixa desmarcar o que não for
// setor de verdade. Dedup normalizado no backend. RD-61: os existentes ficam como estão.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { Layers, RefreshCw, Download, AlertTriangle, CheckCircle2 } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  gray: '#6b6b6b', green: '#2d6a3e', greenBg: '#e8f3ec', amber: '#8a6a10', amberBg: '#fdf4e0', blue: '#1f4e79', blueBg: '#e8f0f8', red: '#a02020', redBg: '#fce8e8',
}
type Candidato = { nome: string; dias: number; ja_existe: boolean }
type Resumo = { no_ponto: number; ja_cadastrados: number; novos: number; ja_em_prod_setor: number }

export default function ComplianceSstPage() {
  const { sel, selInfo, loading } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null

  const [cands, setCands] = useState<Candidato[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [sel2, setSel2] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const carregar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true); setErro(''); setOkMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_compliance_setores_do_ponto_preview', { p_company_id: companyId })
      if (error) throw error
      const r = data as { ok: boolean; erro?: string; candidatos?: Candidato[]; resumo?: Resumo }
      if (!r?.ok) throw new Error(r?.erro || 'falha na prévia')
      setCands(r.candidatos || []); setResumo(r.resumo || null)
      // novos vêm marcados por padrão; já existentes não são selecionáveis
      setSel2(new Set((r.candidatos || []).filter(c => !c.ja_existe).map(c => c.nome)))
    } catch (e) { setErro((e as Error).message) } finally { setCarregando(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const toggle = (nome: string) => setSel2(prev => { const n = new Set(prev); if (n.has(nome)) n.delete(nome); else n.add(nome); return n })

  const importar = async () => {
    if (!companyId || sel2.size === 0) return
    setImportando(true); setErro(''); setOkMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_compliance_setores_importar_do_ponto', { p_company_id: companyId, p_nomes: Array.from(sel2) })
      if (error) throw error
      const r = data as { ok: boolean; erro?: string; antes?: number; criados?: number; depois?: number }
      if (!r?.ok) throw new Error(r?.erro === 'sem_planta' ? 'Empresa sem planta industrial configurada — configure a planta antes de importar setores.' : (r?.erro || 'falha na importação'))
      setOkMsg(`Importado: ${r.criados} setor(es) criado(s). Total agora: ${r.depois} (antes ${r.antes}).`)
      await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setImportando(false) }
  }

  if (loading) return <Wrap><div style={{ color: C.gray, padding: 40 }}>Carregando…</div></Wrap>
  if (!companyId) return <Wrap><Header /><Vazio titulo="Selecione uma empresa" texto="O cadastro de setores é por empresa. Escolha uma empresa específica no topo (não Consolidado/Grupo)." /></Wrap>

  const novos = cands.filter(c => !c.ja_existe)

  return (
    <Wrap>
      <Header />

      <div style={{ display: 'flex', gap: 10, background: C.blueBg, border: `1px solid ${C.blue}33`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <Layers size={18} style={{ color: C.blue, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.55 }}>
          O LTCAT organiza risco, EPI e treinamento por <b>setor → função</b>. O primeiro passo é ter os setores da sua operação cadastrados. Trazemos os <b>setores do ponto eletrônico</b> — confira a lista, desmarque o que não for setor de verdade e importe. Os que já existem ficam como estão.
        </div>
      </div>

      {erro && <div style={box(C.redBg, C.red)}>{erro}</div>}
      {okMsg && <div style={box(C.greenBg, C.green)}><CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{okMsg}</div>}

      {resumo && (
        <div style={{ fontSize: 13, color: C.espresso, marginBottom: 10 }}>
          Encontramos <b>{resumo.no_ponto}</b> setor(es) no ponto · <b style={{ color: C.green }}>{resumo.ja_cadastrados}</b> já cadastrado(s) · <b style={{ color: C.gold }}>{resumo.novos}</b> novo(s). Você tem <b>{resumo.ja_em_prod_setor}</b> setor(es) em cadastro hoje.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Btn onClick={carregar} disabled={carregando} ghost><RefreshCw size={14} /> {carregando ? 'Atualizando…' : 'Atualizar'}</Btn>
        <Btn onClick={importar} disabled={importando || sel2.size === 0}><Download size={14} /> {importando ? 'Importando…' : `Importar ${sel2.size} selecionado(s)`}</Btn>
      </div>

      {!carregando && cands.length === 0 ? (
        <Vazio titulo="Nenhum setor no ponto" texto="Não há department no ponto eletrônico desta empresa. Importe o relatório de ponto primeiro." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={th()} /><th style={th()}>Setor (do ponto)</th><th style={th()}>Dias no ponto</th><th style={th()}>Situação</th>
            </tr></thead>
            <tbody>
              {cands.map((c) => (
                <tr key={c.nome} style={{ borderBottom: `1px solid ${C.beigeLt}`, opacity: c.ja_existe ? 0.6 : 1 }}>
                  <td style={td()}>
                    <input type="checkbox" disabled={c.ja_existe} checked={c.ja_existe || sel2.has(c.nome)} onChange={() => toggle(c.nome)} style={{ width: 16, height: 16, accentColor: C.gold, cursor: c.ja_existe ? 'not-allowed' : 'pointer' }} />
                  </td>
                  <td style={{ ...td(), fontWeight: 600 }}>{c.nome}</td>
                  <td style={td()}>{c.dias}</td>
                  <td style={td()}>
                    {c.ja_existe
                      ? <span style={{ color: C.green, fontSize: 12 }}>já cadastrado</span>
                      : <span style={{ color: C.gold, fontSize: 12 }}>novo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {novos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', fontSize: 12, color: C.gray }}>
              <AlertTriangle size={14} style={{ color: C.amber }} /> Desmarque o que for turno, equipe ou sigla — só setor de verdade vira cadastro. O que já existe não é tocado.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 20, fontSize: 12, color: C.gray, lineHeight: 1.5 }}>
        Depois dos setores, o próximo passo do LTCAT é definir, por setor e por função, os <b>riscos</b>, os <b>EPIs obrigatórios</b> e os <b>treinamentos</b>. O sistema organiza a informação — <b>o laudo é assinado por engenheiro ou médico do trabalho</b>.
      </div>
    </Wrap>
  )
}

function Wrap({ children }: { children: React.ReactNode }) { return <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px', color: C.espresso }}>{children}</div> }
function Header() { return <div style={{ marginBottom: 16 }}><div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 500, color: C.espresso }}>SST · LTCAT</div><div style={{ fontSize: 13, color: C.gray }}>Setores, riscos, EPIs e treinamentos por função — base para o LTCAT.</div></div> }
function Vazio({ titulo, texto }: { titulo: string; texto: string }) { return <div style={{ background: '#fff', border: `1px dashed ${C.borderLt}`, borderRadius: 14, padding: '32px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: C.espresso }}>{titulo}</div><div style={{ fontSize: 13, color: C.gray, marginTop: 5, maxWidth: 460, marginInline: 'auto' }}>{texto}</div></div> }
function Btn({ children, onClick, disabled, ghost }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; ghost?: boolean }) {
  return <button onClick={onClick} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', border: ghost ? `1px solid ${C.borderLt}` : 'none', background: ghost ? '#fff' : (disabled ? '#d9c9a6' : C.gold), color: ghost ? C.espresso : '#fff' }}>{children}</button>
}
function box(bg: string, c: string): React.CSSProperties { return { background: bg, color: c, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 10 } }
function th(): React.CSSProperties { return { padding: '8px 10px', fontWeight: 600, fontSize: 12 } }
function td(): React.CSSProperties { return { padding: '9px 10px', verticalAlign: 'middle', color: C.espresso } }
