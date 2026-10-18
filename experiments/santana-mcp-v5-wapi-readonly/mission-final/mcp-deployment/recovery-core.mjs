export function recoveryAccess(fragment) {
  const p = new URLSearchParams(fragment.replace(/^#/, ''));
  if (p.get('type') !== 'recovery' || p.has('error') || p.has('error_code')) return null;
  const token = p.get('access_token');
  if (!token || token.length > 16384 || !/^[A-Za-z0-9_.-]+$/.test(token)) return null;
  const expiry = Number(p.get('expires_at'));
  if (p.has('expires_at') && (!Number.isFinite(expiry) || expiry <= Date.now()/1000)) return null;
  return token;
}
export function passwordProblem(password, confirmation) {
  if (password.length < 12) return 'Use pelo menos 12 caracteres.';
  if (password.length > 128) return 'Use até 128 caracteres.';
  if (password !== confirmation) return 'As duas senhas precisam ser iguais.';
  return '';
}
