'use client'

interface Props {
  aberto: boolean
  onConfirmar: () => void
  onCancelar: () => void
}

// Confirmação padrão antes de clonar um cadastro (serviço/produto): cancelar não faz nada.
export default function ConfirmarClonar({ aberto, onConfirmar, onCancelar }: Props) {
  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-testid="confirmar-clonar">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-[16px] font-semibold text-[#3D2314]">Deseja mesmo clonar este item?</h3>
        <p className="mt-2 text-[13.5px] text-[#3D2314]/70">Será aberto um novo cadastro pré-preenchido com os dados deste item.</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancelar} data-testid="confirmar-clonar-cancelar" className="rounded-lg px-4 py-2 text-[13px] text-[#3D2314]/70 hover:bg-stone-100">Cancelar</button>
          <button type="button" onClick={onConfirmar} data-testid="confirmar-clonar-ok" autoFocus className="rounded-lg bg-[#C8941A] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#A87810]">Confirmar</button>
        </div>
      </div>
    </div>
  )
}
