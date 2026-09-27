// #94/#142 · texto da observação da NF-e de DEVOLUÇÃO DE COMPRA (dados adicionais da DANFE):
// "Devolução referente à NF-e nº X, série Y, emitida em DD/MM/AAAA - chave de acesso …".
// Sem dependências: usado pela rota que emite (servidor) e pela tela, que mostra a prévia antes de emitir.

export type NotaOrigem = { numero?: string | null; serie?: string | null; data_emissao?: string | null }

function dataBR(valor: string): string {
  // Postgres devolve "2026-09-23 17:31:15+00": o Date do JS exige "T" e fuso com minutos ("+00:00").
  const iso = valor.trim().replace(' ', 'T').replace(/(T[0-9:.]+[+-]\d{2})$/, '$1:00')
  // Data "pura" gravada como meia-noite UTC: é o próprio dia (não converter de fuso, senão vira o dia anterior).
  if (/T00:00:00(\.0+)?(\+00:00|Z)?$/.test(iso) || /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [a, m, d] = iso.slice(0, 10).split('-')
    return `${d}/${m}/${a}`
  }
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export function textoObsDevolucaoCompra(chave: string, nota: NotaOrigem | null): string {
  // Leiaute da chave: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
  const numero = String(nota?.numero ?? '').trim() || String(Number(chave.slice(25, 34)))
  const serie = String(nota?.serie ?? '').trim() || String(Number(chave.slice(22, 25)))
  const data = nota?.data_emissao ? dataBR(String(nota.data_emissao)) : ''
  return `Devolução referente à NF-e nº ${numero}, série ${serie}${data ? `, emitida em ${data}` : ''} - chave de acesso ${chave}.`
}
