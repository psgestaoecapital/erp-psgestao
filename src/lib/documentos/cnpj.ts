// CNPJ: só dígitos + dígitos verificadores (mod 11 com pesos 2..9 cíclicos), par com cpf.ts.
export const soDigitosCnpj = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

export function cnpjValido(v: string | null | undefined): boolean {
  const d = soDigitosCnpj(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (len: number) => {
    // pesos começam em 2 (da direita p/ esquerda), vão até 9 e reiniciam em 2.
    let s = 0
    let peso = 2
    for (let i = len - 1; i >= 0; i--) {
      s += Number(d[i]) * peso
      peso = peso === 9 ? 2 : peso + 1
    }
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

/** 11222333000181 → 11.222.333/0001-81 (formata o que já tem enquanto digita). */
export function mascaraCnpj(v: string): string {
  const d = soDigitosCnpj(v).slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}
