import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';

interface Props {
  redirectTo?: string;
}

export function SocialButtons({ redirectTo }: Props) {
  async function handleClick(provider: 'google' | 'apple') {
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
  }

  return (
    <div className="grid gap-3">
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => handleClick('google')}
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-700 hover:bg-gray-50 transition-all"
        aria-label="Continue with Google"
      >
        Continue with Google
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => handleClick('apple')}
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-700 hover:bg-gray-50 transition-all"
        aria-label="Continue with Apple"
      >
        Continue with Apple
      </motion.button>
    </div>
  );
}


