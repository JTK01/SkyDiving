/** Form validation rules shared by the login & signup cards. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

export function validateEmail(v) {
  if (!v.trim()) return '이메일을 입력해 주세요.'
  if (!EMAIL_RE.test(v.trim())) return '올바른 이메일 형식이 아닙니다.'
  return ''
}

export function validateUsername(v) {
  if (!v.trim()) return '사용자 이름을 입력해 주세요.'
  if (!USERNAME_RE.test(v.trim())) return '3~20자의 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.'
  return ''
}

export function validatePassword(v, { strict = true } = {}) {
  if (!v) return '비밀번호를 입력해 주세요.'
  if (!strict) return ''
  if (v.length < 8) return '비밀번호는 8자 이상이어야 합니다.'
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return '영문과 숫자를 모두 포함해 주세요.'
  return ''
}

export function validateConfirm(pw, confirm) {
  if (!confirm) return '비밀번호를 한 번 더 입력해 주세요.'
  if (pw !== confirm) return '비밀번호가 일치하지 않습니다.'
  return ''
}

export function validateLogin({ email, password }) {
  return { email: validateEmail(email), password: validatePassword(password, { strict: false }) }
}

export function validateSignup({ email, username, password, confirm }) {
  return {
    email: validateEmail(email),
    username: validateUsername(username),
    password: validatePassword(password),
    confirm: validateConfirm(password, confirm),
  }
}

export const hasErrors = (errors) => Object.values(errors).some(Boolean)
