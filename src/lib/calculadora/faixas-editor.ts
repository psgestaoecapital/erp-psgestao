// Edição das faixas de pé-direito da parede: texto do formulário → faixas válidas. Faixa inválida nunca é salva.
import type { FaixaPeDireito } from './motor'

export type FaixaForm = { de: string; ate: string; bitola: string; espacamento: string; duplo: boolean }
export const BITOLAS: FaixaPeDireito['bitola'][] = ['M48', 'M70', 'M90']
export const ESPACAMENTOS: FaixaPeDireito['espacamento'][] = [0.4, 0.6]
export const MAX_FAIXAS = 20

const num = (s: string) => Number(s.trim().replace(',', '.'))
export const faixasParaForm = (fx: FaixaPeDireito[]): FaixaForm[] =>
  fx.map((x) => ({ de: String(x.de).replace('.', ','), ate: String(x.ate).replace('.', ','), bitola: x.bitola, espacamento: String(x.espacamento), duplo: x.duplo }))

export function montarFaixas(form: FaixaForm[]): { ok: true; faixas: FaixaPeDireito[] } | { ok: false; erro: string } {
  if (form.length === 0) return { ok: false, erro: 'Cadastre ao menos uma faixa de pé-direito.' }
  if (form.length > MAX_FAIXAS) return { ok: false, erro: `No máximo ${MAX_FAIXAS} faixas.` }
  const out: FaixaPeDireito[] = []
  for (let i = 0; i < form.length; i++) {
    const f = form[i], n = i + 1
    const de = num(f.de), ate = num(f.ate), esp = num(f.espacamento)
    if (f.de.trim() === '' || f.ate.trim() === '' || !Number.isFinite(de) || !Number.isFinite(ate)) return { ok: false, erro: `Faixa ${n}: preencha "de" e "até" com números.` }
    if (de <= 0 || ate < de) return { ok: false, erro: `Faixa ${n}: "de" deve ser maior que zero e "até" não pode ser menor que "de".` }
    if (!BITOLAS.includes(f.bitola as FaixaPeDireito['bitola'])) return { ok: false, erro: `Faixa ${n}: escolha a bitola do perfil.` }
    if (esp !== 0.4 && esp !== 0.6) return { ok: false, erro: `Faixa ${n}: o espaçamento do montante é 0,40 ou 0,60 m.` }
    out.push({ de, ate, bitola: f.bitola as FaixaPeDireito['bitola'], espacamento: esp, duplo: f.duplo })
  }
  out.sort((a, b) => a.de - b.de)
  for (let i = 1; i < out.length; i++) if (out[i].de <= out[i - 1].ate) return { ok: false, erro: `As faixas ${i} e ${i + 1} se sobrepõem (${out[i - 1].ate} m e ${out[i].de} m).` }
  return { ok: true, faixas: out }
}

export const faixasIguais = (a: FaixaPeDireito[], b: FaixaPeDireito[]) => JSON.stringify(a) === JSON.stringify(b)
