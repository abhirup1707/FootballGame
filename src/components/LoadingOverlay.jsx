import { motion } from "framer-motion";

export default function LoadingOverlay({ message }) {
  return (
    <motion.div
      className="loading-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="loading-ball">⚽</div>
      {message && <p>{message}</p>}
    </motion.div>
  );
}
