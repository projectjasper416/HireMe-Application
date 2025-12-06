import { motion } from 'framer-motion';

interface Props {
  apiBaseUrl: string;
  token: string;
}

export function AdminDashboardPage({ apiBaseUrl, token }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-4xl"
    >
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-4xl font-bold text-gray-900">Welcome to Admin Page</h1>
      </div>
    </motion.div>
  );
}

