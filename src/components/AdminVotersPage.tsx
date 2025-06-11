import { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

interface Vote {
  name: string;
  email: string;
  choice: string;
  timestamp: string;
}

export default function AdminVotersPage() {
  const [voters, setVoters] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchVotes() {
      try {
        const votesQuery = query(collection(db, 'votes'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(votesQuery);
        const loadedVotes: Vote[] = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            name: data.userName,
            email: data.userEmail,
            choice: data.choice,
            timestamp: new Date(data.createdAt?.seconds * 1000).toLocaleString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            }),
          };
        });
        setVoters(loadedVotes);
      } catch (err) {
        console.error('Failed to fetch votes:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchVotes();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">🧑‍💻 Who Voted This Week</h1>
          <a
            href="/admin"
            className="text-blue-600 hover:underline text-sm"
          >
            ← Back to Admin Dashboard
          </a>
        </div>

        {loading ? (
          <p className="text-center text-gray-500">Loading...</p>
        ) : voters.length === 0 ? (
          <p className="text-center text-gray-500">No votes submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white rounded-lg shadow-md overflow-hidden">
              <thead className="bg-gray-100 text-gray-700 text-sm uppercase">
                <tr>
                  <th className="text-left px-6 py-3">Choice</th>
                  <th className="text-left px-6 py-3">Email</th>
                  <th className="text-left px-6 py-3">Voted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm">
                {voters.map((vote, index) => (
                  <tr key={index} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">{vote.choice}</td>
                    <td className="px-6 py-4">{vote.email}</td>
                    <td className="px-6 py-4">{vote.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
