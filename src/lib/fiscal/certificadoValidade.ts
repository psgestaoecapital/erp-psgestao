// #5661 — situação do certificado A1 DERIVADA da data de validade, na hora da leitura (não depende de rotina que
// possa falhar): validade_fim < hoje => "vencido", mesmo que erp_certificados_a1.status ainda diga 'ativo'.
export type SituacaoCertificado = {
  estado: 'sem_data' | 'vencido' | 'vence_em_breve' | 'valido'
  dias: number | null // dias até o fim da validade (negativo = vencido há N dias)
  fim: string | null // dd/mm/aaaa
  mensagem: string | null
}

const DIA = 86_400_000

function parseFim(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const s = String(iso).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function situacaoCertificado(validadeFim: string | null | undefined, agora: Date = new Date()): SituacaoCertificado {
  const fim = parseFim(validadeFim)
  if (!fim) return { estado: 'sem_data', dias: null, fim: null, mensagem: null }
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
  const dias = Math.round((fim.getTime() - hoje.getTime()) / DIA)
  const txt = fim.toLocaleDateString('pt-BR')
  if (dias < 0) {
    return { estado: 'vencido', dias, fim: txt, mensagem: `Certificado vencido em ${txt}; envie um novo certificado.` }
  }
  if (dias <= 30) {
    return {
      estado: 'vence_em_breve', dias, fim: txt,
      mensagem: dias === 0 ? `O certificado vence hoje (${txt}); envie um novo.` : `O certificado vence em ${dias} dia${dias === 1 ? '' : 's'} (${txt}); providencie a renovação.`,
    }
  }
  return { estado: 'valido', dias, fim: txt, mensagem: null }
}
