import { LogIn } from 'lucide-react';
import { loginWithGoogle } from '../../firebaseConfig';
import { btn, btnSize, cn, panel } from './ui/styles';

export default function Login({ onLogin = loginWithGoogle }: { onLogin?: () => void }) {
  return (
    <section className={cn(panel, 'animate-rise p-6 text-center sm:p-8')}>
      <h2 className="font-display text-xl font-bold tracking-tight">
        Sign in to vote <span aria-hidden="true">👋</span>
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
        Use your <span className="font-semibold text-ink">@calvada.com</span> Google account. One
        vote per person, per week.
      </p>
      <button onClick={onLogin} className={cn(btn.primary, btnSize.md, 'mt-5')}>
        <LogIn size={16} strokeWidth={2.25} aria-hidden="true" />
        Sign in with Google
      </button>
    </section>
  );
}
