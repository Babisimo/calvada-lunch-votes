import { LogIn } from 'lucide-react';
import { loginWithGoogle } from '../../firebaseConfig';
import { btn, btnSize, cn, panel } from './ui/styles';

export default function Login({ onLogin = loginWithGoogle }: { onLogin?: () => void }) {
  return (
    <section
      className={cn(panel, 'paper-tear animate-rise relative p-6 pt-8 text-center sm:p-8 sm:pt-10')}
    >
      <h2 className="ticket-title text-2xl">Start a tab</h2>
      <p className="mx-auto mt-2.5 max-w-sm text-sm text-ink-muted">
        Sign in with your <span className="font-semibold text-ink">@calvada.com</span> Google
        account. One order per person, per week.
      </p>
      <button onClick={onLogin} className={cn(btn.primary, btnSize.md, 'mt-5')}>
        <LogIn size={16} strokeWidth={2.25} aria-hidden="true" />
        Sign in with Google
      </button>
    </section>
  );
}
