import { motion } from "framer-motion";

const bounce = {
  y: [0, -20, 0],
  rotate: [0, 180, 360],
  transition: { duration: 1, repeat: Infinity, ease: "easeInOut" },
};

export default function LoadingOverlay({ message }) {
  return (
    <motion.div
      className="loading-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="loading-content">
        <motion.div className="loading-ball" animate={bounce}>
          <span className="loading-ball-inner">⚽</span>
        </motion.div>
        <div className="loading-rings">
          <span className="loading-ring loading-ring-1" />
          <span className="loading-ring loading-ring-2" />
          <span className="loading-ring loading-ring-3" />
        </div>
        {message && <p className="loading-text">{message}</p>}
      </div>
    </motion.div>
  );
}
