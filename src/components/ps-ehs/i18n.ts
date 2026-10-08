// PS EHS — dicionário pt/en/es da vertical (E0). Chaves planas; pt é o padrão e o fallback.
export type EhsIdioma = 'pt' | 'en' | 'es'

export const EHS_IDIOMAS: EhsIdioma[] = ['pt', 'en', 'es']

const DICT = {
  'ehs.nome': { pt: 'PS EHS', en: 'PS EHS', es: 'PS EHS' },
  'ehs.subtitulo': {
    pt: 'Saúde, Segurança e Meio Ambiente',
    en: 'Health, Safety and Environment',
    es: 'Salud, Seguridad y Medio Ambiente',
  },
  'ehs.painel': { pt: 'Painel PS EHS', en: 'PS EHS Dashboard', es: 'Panel PS EHS' },
  'ehs.painel.descricao': {
    pt: 'Documentação de funcionários e empresa, com alertas de validade.',
    en: 'Employee and company documentation, with expiry alerts.',
    es: 'Documentación de empleados y empresa, con alertas de vencimiento.',
  },
  'status.ok': { pt: 'Em dia', en: 'Compliant', es: 'Al día' },
  'status.atencao': { pt: 'Atenção', en: 'Attention', es: 'Atención' },
  'status.critico': { pt: 'Crítico', en: 'Critical', es: 'Crítico' },
  'status.neutro': { pt: 'Sem dados', en: 'No data', es: 'Sin datos' },
  'cockpit.papel': { pt: 'Papel', en: 'Role', es: 'Rol' },
  'timeline.titulo': { pt: 'Linha do tempo', en: 'Timeline', es: 'Línea de tiempo' },
  'passo.de': { pt: 'Passo', en: 'Step', es: 'Paso' },
  'passo.voltar': { pt: 'Voltar', en: 'Back', es: 'Volver' },
  'passo.avancar': { pt: 'Avançar', en: 'Next', es: 'Siguiente' },
  'passo.previa': { pt: 'Prévia do documento', en: 'Document preview', es: 'Vista previa del documento' },
  'campo.voz': { pt: 'Falar', en: 'Speak', es: 'Hablar' },
  'campo.foto': { pt: 'Foto', en: 'Photo', es: 'Foto' },
  'campo.qr': { pt: 'Ler QR', en: 'Scan QR', es: 'Leer QR' },
} as const

export type EhsChave = keyof typeof DICT

export function tEhs(chave: EhsChave, idioma: EhsIdioma = 'pt'): string {
  const e = DICT[chave]
  return e[idioma] ?? e.pt
}

export function ehsChaves(): EhsChave[] {
  return Object.keys(DICT) as EhsChave[]
}
