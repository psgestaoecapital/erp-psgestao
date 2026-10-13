'use client'
// Campos condicionais de PIX (aparecem quando a forma = Pix): tipo de chave + chave com máscara/validação.
// Reutilizável em Nova despesa, Nova receita e Editar. Pendência Jordana #4.
import { TIPOS_CHAVE_PIX, mascararChavePix, validarChavePix } from '@/lib/financeiro/formasPagamento'

export function CamposPix({ tipoChave, chave, setTipoChave, setChave, inputStyle }: {
  tipoChave: string
  chave: string
  setTipoChave: (v: string) => void
  setChave: (v: string) => void
  inputStyle: React.CSSProperties
}) {
  const erro = chave.trim() ? validarChavePix(tipoChave, chave) : null
  const placeholder =
    tipoChave === 'cpf_cnpj' ? '000.000.000-00 ou CNPJ'
      : tipoChave === 'telefone' ? '(00) 00000-0000'
      : tipoChave === 'email' ? 'nome@dominio.com'
      : tipoChave === 'aleatoria' ? 'chave aleatória (UUID)'
      : 'cole o PIX copia e cola'

  return (
    <div style={{ gridColumn: '1 / -1', background: '#FBF6EC', border: '0.5px solid rgba(200,148,26,0.5)', borderRadius: 10, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 2fr', gap: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>
        Tipo de chave PIX
        <select
          value={tipoChave}
          onChange={(e) => { setTipoChave(e.target.value); setChave('') }}
          style={{ ...inputStyle, marginTop: 4 }}
        >
          {TIPOS_CHAVE_PIX.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
      </label>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>
        Chave PIX
        <input
          value={chave}
          onChange={(e) => setChave(tipoChave === 'copia_cola' || tipoChave === 'email' || tipoChave === 'aleatoria' ? e.target.value : mascararChavePix(tipoChave, e.target.value))}
          placeholder={placeholder}
          style={{ ...inputStyle, marginTop: 4, borderColor: erro ? '#DC2626' : (inputStyle.borderColor as string) }}
        />
        <small style={{ fontSize: 11, color: erro ? '#DC2626' : 'rgba(61,35,20,0.55)', marginTop: 2, display: 'block' }}>
          {erro ?? 'Vai pra remessa de pagamento ao banco.'}
        </small>
      </label>
    </div>
  )
}
