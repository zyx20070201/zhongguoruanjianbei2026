import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const login = useAuthStore(state => state.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;
    await login(username);
    navigate('/workspaces');
  };

  return (
    <div className="flex items-center justify-center h-full">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow-md w-96">
        <h2 className="text-2xl font-bold mb-6 text-center">Login</h2>
        <div className="mb-4">
          <label className="block text-gray-700 mb-2">Username</label>
          <input
            type="text"
            className="w-full border p-2 rounded"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter testuser"
          />
        </div>
        <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          Login / Register
        </button>
      </form>
    </div>
  );
}
