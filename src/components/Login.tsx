import { loginWithGoogle } from '../../firebaseConfig';

export default function Login({ onLogin = loginWithGoogle }: { onLogin?: () => void }) {
  return (
    <div className="mb-12 text-center">
      <p className="text-lg text-gray-950-700 mb-4">
        Please sign in with your Google account to vote.
      </p>
      <button
        onClick={onLogin}
        className="px-6 py-3 rounded-md cursor-pointer text-black bg-gradient-to-r from-blue-600 to-blue-500 shadow hover:shadow-lg transition"
      >
        🔐 Sign in with Google
      </button>
    </div>
  );
}
