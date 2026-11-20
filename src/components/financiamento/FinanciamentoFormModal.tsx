'use client'
import { useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { SECTIONS, type Field } from './fields'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

// "?" (RD-95) ao lado de cada campo do formulário — texto vem de erp_ajuda_campo (chave ge.financiamento.<key>).
const ROTA_AJUDA = '/dashboard/gestao-empresarial/financiamento'

type FormState = Record<string, string | number | boolean | null>

interface Props {
  companyId: string
  initial?: (Record<string, unknown> & { id?: string }) | null
  onClose: () => void
  // savedId/isNew/aviso permitem à tela abrir o contrato novo já no Cronograma e orientar o próximo passo.
  onSaved: (savedId?: string, isNew?: boolean, aviso?: string) => void
}

export default function FinanciamentoFormModal({ companyId, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(
    (initial as FormState | null | undefined) ?? {
      status: 'ativo',
      tipo_operacao: 'financiamento',
      periodicidade: 'mensal',
      em_carencia: false,
      contemplado: false,
    }
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isEdit = !!initial?.id
  const isConsorcio = form.tipo_operacao === 'consorcio'

  const set = (k: string, v: string | number | boolean | null) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    setErr(null)
    const payload: FormState = { ...form, company_id: companyId }
    let savedId = initial?.id ?? null
    if (isEdit) {
      const res = await supabase.from('financiamentos').update(payload).eq('id', initial!.id!)
      if (res.error) { setSaving(false); setErr(erroAmigavel(res.error, 'Não foi possível salvar o contrato. Confira os dados e tente de novo.')); return }
    } else {
      const res = await supabase.from('financiamentos').insert(payload).select('id').single()
      if (res.error) { setSaving(false); setErr(erroAmigavel(res.error, 'Não foi possível salvar o contrato. Confira os dados e tente de novo.')); return }
      savedId = (res.data as { id: string } | null)?.id ?? null
    }

    // Contrato NOVO: gera o cronograma automaticamente (jornada — as parcelas já aparecem, sem exigir
    // que o usuário clique "Gerar cronograma" depois). Se faltar valor/nº de parcelas, a RPC devolve
    // ok:false com motivo claro: o contrato fica salvo e orientamos o próximo passo (não bloqueia).
    let aviso: string | undefined
    if (savedId && !isEdit) {
      const cron = await supabase.rpc('fn_financiamento_gerar_cronograma', { p_id: savedId })
      const cj = cron.data as { ok?: boolean; erro?: string } | null
      aviso = (cron.error || (cj && cj.ok === false))
        ? 'Contrato criado. Preencha valor e nº de parcelas e use "Gerar cronograma" no contrato.'
        : 'Contrato criado e cronograma gerado. Confira as parcelas e gere as contas a pagar.'
    }

    // Recalcula parcelas_pagas/saldo/valor_parcela via RPC (apos gerar o cronograma, quando novo).
    // RPC ja valida company_id via get_user_company_ids() — RLS-safe.
    if (savedId) {
      const rec = await supabase.rpc('fn_financiamento_recalcular', { p_id: savedId })
      if (rec.error) {
        setSaving(false)
        setErr(erroAmigavel(rec.error, 'Salvou, mas não foi possível recalcular agora. Tente "Recalcular" no contrato.'))
        return
      }
      const r = rec.data as { ok?: boolean; erro?: string } | null
      if (r && r.ok === false) {
        setSaving(false)
        setErr(r.erro ?? 'Salvou, mas não recalculou.')
        return
      }
    }

    setSaving(false)
    onSaved(savedId ?? undefined, !isEdit, aviso)
  }

  const renderInput = (fd: Field) => {
    const value = form[fd.key]
    if (fd.type === 'bool') {
      return (
        <span style={campoAjuda}>
          <input
            type="checkbox"
            checked={!!value}
            disabled={fd.readOnly}
            onChange={(e) => set(fd.key, e.target.checked)}
          />
          <AjudaCampo chave={`ge.financiamento.form.${fd.key}`} rota={ROTA_AJUDA} />
        </span>
      )
    }
    if (fd.type === 'select') {
      return (
        <span style={campoAjuda}>
          <select
            value={(value as string) ?? ''}
            disabled={fd.readOnly}
            onChange={(e) => set(fd.key, e.target.value)}
            style={inp}
          >
            <option value="">—</option>
            {fd.opts!.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <AjudaCampo chave={`ge.financiamento.form.${fd.key}`} rota={ROTA_AJUDA} />
        </span>
      )
    }
    const t =
      fd.type === 'date' ? 'date' :
      (fd.type === 'number' || fd.type === 'money' || fd.type === 'percent') ? 'number' : 'text'
    const isNum = t === 'number'
    return (
      <span style={campoAjuda}>
        <input
          type={t}
          value={(value as string | number | null) ?? ''}
          disabled={fd.readOnly}
          onChange={(e) =>
            set(
              fd.key,
              isNum
                ? e.target.value === '' ? null : Number(e.target.value)
                : e.target.value
            )
          }
          style={inp}
        />
        <AjudaCampo chave={`ge.financiamento.form.${fd.key}`} rota={ROTA_AJUDA} />
      </span>
    )
  }

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#3D2314', margin: 0 }}>
            {isEdit ? 'Editar contrato' : 'Novo contrato'}
          </h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>
        {SECTIONS.filter((s) => !s.soConsorcio || isConsorcio).map((sec) => (
          <div key={sec.id} style={{ marginBottom: 16 }}>
            <div style={secHead}>{sec.label}</div>
            <div style={grid}>
              {sec.fields.map((fd) => (
                <label key={fd.key} style={lbl}>
                  {fd.label}{fd.readOnly ? ' (auto)' : ''}
                  {renderInput(fd)}
                </label>
              ))}
            </div>
          </div>
        ))}
        {err && <p style={{ color: '#b00', fontSize: 13 }}>Erro: {err}</p>}
        <div style={actions}>
          <span style={campoAjuda}><button onClick={onClose} style={btnGhost}>Cancelar</button><AjudaCampo chave="ge.financiamento.form_cancelar" rota={ROTA_AJUDA} /></span>
          <span style={campoAjuda}>
            <button onClick={save} disabled={saving} style={btnPrimary}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <AjudaCampo chave="ge.financiamento.form_salvar" rota={ROTA_AJUDA} />
          </span>
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.45)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 16,
  zIndex: 50,
  overflow: 'auto',
}
const card: CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: 20,
  width: '100%',
  maxWidth: 760,
}
const head: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
}
const closeBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  fontSize: 20,
  cursor: 'pointer',
  minWidth: 44,
  minHeight: 44,
}
const secHead: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#C8941A',
  marginBottom: 8,
  borderBottom: '1px solid #efe9e2',
  paddingBottom: 4,
}
const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
}
const lbl: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#6b6b6b',
}
const inp: CSSProperties = {
  border: '1px solid #E7DED3',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  minHeight: 40,
  flex: 1,
  minWidth: 0,
}
const campoAjuda: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}
const actions: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 8,
}
const btnGhost: CSSProperties = {
  border: '1px solid #E7DED3',
  background: '#fff',
  borderRadius: 10,
  padding: '10px 16px',
  cursor: 'pointer',
  minHeight: 44,
}
const btnPrimary: CSSProperties = {
  border: 'none',
  background: '#C8941A',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 16px',
  cursor: 'pointer',
  fontWeight: 600,
  minHeight: 44,
}
