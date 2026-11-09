import { forwardRef, useState } from 'react'
import Field from './Field'
import { useAuth } from '../auth/AuthController'
import { validateLogin, hasErrors } from '../auth/validation'
import { DEMO_ACCOUNT } from '../auth/providers/localAuthProvider'

/** Scene 03 — login card (presentation + form state only; auth via useAuth). */
const LoginScene = forwardRef(function LoginScene({ active, disabled, onSuccess, onCreateAccount }, ref) {
  const { signIn, status } = useAuth()
  const [values, setValues] = useState({ email: '', password: '' })
  const [touched, setTouched] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')

  const errors = validateLogin(values)
  const show = (k) => (submitted || touched[k] ? errors[k] : '')
  const pending = status === 'pending'
  const blocked = disabled || pending || !active

  const set = (k) => (e) => {
    setValues((v) => ({ ...v, [k]: e.target.value }))
    setFormError('')
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (blocked) return
    setSubmitted(true)
    if (hasErrors(errors)) return
    try {
      const user = await signIn(values)
      onSuccess(user)
    } catch (err) {
      setFormError(err.message || '로그인에 실패했습니다.')
    }
  }

  return (
    <form
      ref={ref}
      className="auth-card"
      onSubmit={onSubmit}
      noValidate
      aria-hidden={!active}
      inert={active ? undefined : ''}
    >
      <header className="auth-card__head" data-head>
        <span className="auth-card__eyebrow">SKY DIVE</span>
        <h2>Welcome back</h2>
        <p>구름 위의 세계로 다시 뛰어들 준비가 되셨나요?</p>
      </header>

      <Field
        label="EMAIL"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@skydive.io"
        value={values.email}
        onChange={set('email')}
        onBlur={() => setTouched((t) => ({ ...t, email: true }))}
        error={show('email')}
        disabled={blocked}
      />
      <Field
        label="PASSWORD"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        value={values.password}
        onChange={set('password')}
        onBlur={() => setTouched((t) => ({ ...t, password: true }))}
        error={show('password')}
        disabled={blocked}
      />

      <p className="auth-card__form-error" role="alert">
        {formError || ' '}
      </p>

      <div data-reveal>
        <button type="submit" className="btn btn--primary" disabled={blocked}>
          {pending ? 'AUTHENTICATING…' : 'LOGIN'}
        </button>
      </div>
      <div data-reveal>
        <button type="button" className="btn btn--ghost" onClick={onCreateAccount} disabled={blocked}>
          CREATE ACCOUNT
        </button>
        <button
          type="button"
          className="auth-card__demo"
          disabled={blocked}
          onClick={() => setValues({ email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password })}
        >
          데모 계정 사용 · {DEMO_ACCOUNT.email} / {DEMO_ACCOUNT.password}
        </button>
      </div>
    </form>
  )
})

export default LoginScene
