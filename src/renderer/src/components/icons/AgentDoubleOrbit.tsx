import { motion } from 'framer-motion';

export function AgentDoubleOrbit() {
  const bgClass = 'bg-indigo-500';

  return (
    <div className="h-6 w-6 relative flex items-center justify-center">
      {/* Central silent star */}
      <div className="h-1 w-1 rounded-full bg-zinc-300" />
      
      {/* Inner orbit */}
      <motion.div
        className="absolute border border-zinc-800/60 rounded-full w-[78%] h-[78%]"
        animate={{ rotate: 360 }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
      >
        <div className={`absolute top-0 left-1/2 -ml-0.5 h-1 w-1 rounded-full ${bgClass}`} />
      </motion.div>

      {/* Outer orbit */}
      <motion.div
        className="absolute border border-zinc-800/40 rounded-full w-full h-full"
        animate={{ rotate: -360 }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
      >
        <div className={`absolute bottom-0 right-1/2 -mr-0.5 h-1 w-1 rounded-full ${bgClass}`} />
      </motion.div>
    </div>
  );
}
