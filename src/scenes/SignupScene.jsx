import { forwardRef, useState } from 'react'
import Field from './Field'
import { useAuth } from '../auth/AuthController'
import { validateSignup, hasErrors } from '../auth/validation'

/** Scene 04 — create-account card. */
const SignupScene = forwardRef(function SignupScene({ active, disabled, onSuccess, onBack }, ref) {
  const { signUp, status } = useAuth()
  const [values, setValues] = useState({ email: '', username: '', password: '', confirm: '' })
  const [touched, setTouched] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')

  const errors = validateSignup(values)
  const show = (k) => (submitted || touched[k] ? errors[k] : '')
  const pending = status === 'pending'
  const blocked = disabled || pending || !active

  const field = (k) => ({
    value: values[k],
    onChange: (e) => {
      setValues((v) => ({ ...v, [k]: e.target.value }))
      setFormError('')
    },
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    error: show(k),
    disabled: blocked,
  })

  const onSubmit = async (e) => {
    e.preventDefault()
    if (blocked) return
    setSubmitted(true)
    if (hasErrors(errors)) return
    try {
      const user = await signUp(values)
      onSuccess(user)
    } catch (err) {
      setFormError(err.message || '회원가입에 실패했습니다.')
    }
  }

  return (
    <form
      ref={ref}
      className="auth-card auth-card--signup"
      onSubmit={onSubmit}
      noValidate
      aria-hidden={!active}
      inert={active ? undefined : ''}
    >
      <header className="auth-card__head" data-head>
        <span className="auth-card__eyebrow">SKY DIVE</span>
        <h2>Create account</h2>
        <p>당신만의 점프 아이디를 만들어 주세요.</p>
      </header>

      <Field label="EMAIL" type="email" autoComplete="email" inputMode="email" placeholder="you@skydive.io" {...field('email')} />
      <Field label="USERNAME" autoComplete="username" placeholder="sky_jumper" {...field('username')} />
      <Field label="PASSWORD" type="password" autoComplete="new-password" placeholder="8자 이상, 영문+숫자" {...field('password')} />
      <Field label="CONFIRM PASSWORD" type="password" autoComplete="new-password" placeholder="••••••••" {...field('confirm')} />

      <p className="auth-card__form-error" role="alert">
        {formError || ' '}
      </p>

      <div data-reveal>
        <button type="submit" className="btn btn--primary" disabled={blocked}>
          {pending ? 'CREATING…' : 'CREATE ACCOUNT'}
        </button>
      </div>
      <div data-reveal>
        <button type="button" className="btn btn--ghost" onClick={onBack} disabled={blocked}>
          BACK TO LOGIN
        </button>
      </div>
    </form>
  )
})

export default SignupScene
