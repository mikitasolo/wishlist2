export default function VerifyRequest() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-primary-100 to-white px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="text-6xl mb-4">📧</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Check your email</h1>
        <p className="text-gray-600 mb-4">A sign in link has been sent to your email address.</p>
        <p className="text-sm text-gray-500">
          Click the link in the email to sign in. You can close this window.
        </p>
      </div>
    </div>
  );
}
