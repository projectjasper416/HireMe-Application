import { useNavigate } from 'react-router-dom';

interface AppHeaderProps {
  profile: any;
  onLogout: () => void;
}

export function AppHeader({ profile, onLogout }: AppHeaderProps) {
  const navigate = useNavigate();

  return (
    <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-4xl font-bold">Welcome Back</h1>
        <p className="text-base text-gray-600">
          {profile?.email || 'Authenticated'} · Role: {profile?.role || 'user'}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => navigate('/job-tracker')}
          className="self-start rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
        >
          Job Tracker
        </button>
        {profile?.role === 'admin' && (
          <button
            onClick={() => navigate('/admin')}
            className="self-start rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
          >
            Admin Dashboard
          </button>
        )}
        <button
          onClick={onLogout}
          className="self-start rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-all hover:border-black/40"
        >
          Logout
        </button>
      </div>
    </div>
  );
}

