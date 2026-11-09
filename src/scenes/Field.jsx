import { forwardRef, useId } from 'react'

/** Glass input with floating label + inline validation message. */
const Field = forwardRef(function Field({ label, error, type = 'text', ...props }, ref) {
  const id = useId()
  return (
    <div className={`field${error ? ' field--error' : ''}`} ref={ref} data-reveal>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} {...props} />
      <p className="field__error" id={`${id}-err`} role={error ? 'alert' : undefined}>
        {error || ' '}
      </p>
    </div>
  )
})

export default Field
