/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  addDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  limit, 
  getDocs, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Bike, RotateCcw, Trash2, User as UserIcon } from 'lucide-react';
import confetti from 'canvas-confetti';

const PLAYERS = ['Berni', 'Mateo', 'Sonja', 'Trieu'];

interface Score {
  playerId: string;
  points: number;
  updatedAt: Timestamp;
}

interface LogEntry {
  id: string;
  playerId: string;
  timestamp: Timestamp;
  type: 'add' | 'reset';
}

export default function App() {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fallingHelmets, setFallingHelmets] = useState<{id: number, x: number, delay: number, speed: number}[]>([]);

  // Auth Listener (not needed anymore but keeping structure clean)
  useEffect(() => {
    setIsLoading(false);
  }, []);

  // Firestore Listeners
  useEffect(() => {
    // Listen to scores
    const unsubScores = onSnapshot(collection(db, 'scores'), (snapshot) => {
      const newScores: Record<string, number> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data() as Score;
        newScores[data.playerId] = data.points;
      });
      setScores(newScores);
    });

    // Listen to recent logs for undo
    const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(10));
    const unsubLogs = onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as LogEntry[];
      setLogs(newLogs);
    });

    return () => {
      unsubScores();
      unsubLogs();
    };
  }, []);

  const triggerHelmetDrop = () => {
    const count = 12;
    const newHelmets = Array.from({ length: count }).map((_, i) => ({
      id: Math.random() + Date.now(),
      x: Math.random() * 90 + 5, // 5% to 95%
      delay: Math.random() * 0.5,
      speed: 1.5 + Math.random() * 1.5
    }));

    setFallingHelmets(prev => [...prev, ...newHelmets]);

    // Cleanup after animation
    setTimeout(() => {
      setFallingHelmets(prev => prev.filter(h => !newHelmets.find(nh => nh.id === h.id)));
    }, 4000);
  };

  const playSound = (type: 'add' | 'undo' | 'reset') => {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'add') {
      // Cozy "pop" or "bubble" sound
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(400, now);
      oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.1);
      gainNode.gain.setValueAtTime(0.3, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } else if (type === 'undo') {
      // Soft "whoosh" or low chime
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(300, now);
      oscillator.frequency.exponentialRampToValueAtTime(150, now + 0.3);
      gainNode.gain.setValueAtTime(0.2, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } else if (type === 'reset') {
      // Gentle "sparkle" or multi-tone chime
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        g.gain.setValueAtTime(0.1, now + i * 0.1);
        g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.4);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.4);
      });
    }
  };

  const addPoint = async (playerId: string) => {
    if (isAdding) return;
    setIsAdding(true);
    playSound('add');
    
    const currentPoints = scores[playerId] || 0;
    const newPoints = currentPoints + 1;

    try {
      // Update score
      await setDoc(doc(db, 'scores', playerId), {
        playerId,
        points: newPoints,
        updatedAt: serverTimestamp()
      });

      // Log action
      await addDoc(collection(db, 'logs'), {
        playerId,
        timestamp: serverTimestamp(),
        type: 'add'
      });

      triggerHelmetDrop();
    } catch (error) {
      console.error("Error adding point", error);
    } finally {
      setIsAdding(false);
    }
  };

  const undoLastAction = async () => {
    if (logs.length === 0) return;
    const lastLog = logs[0];
    playSound('undo');

    try {
      if (lastLog.type === 'add') {
        const currentPoints = scores[lastLog.playerId] || 0;
        await setDoc(doc(db, 'scores', lastLog.playerId), {
          playerId: lastLog.playerId,
          points: Math.max(0, currentPoints - 1),
          updatedAt: serverTimestamp()
        });
      }
      // Delete the log entry
      await deleteDoc(doc(db, 'logs', lastLog.id));
    } catch (error) {
      console.error("Error undoing action", error);
    }
  };

  const resetAll = async () => {
    if (!window.confirm("Are you sure you want to reset ALL scores? This cannot be undone.")) return;
    playSound('reset');

    try {
      const promises = PLAYERS.map(playerId => 
        setDoc(doc(db, 'scores', playerId), {
          playerId,
          points: 0,
          updatedAt: serverTimestamp()
        })
      );
      await Promise.all(promises);
      
      // Clear logs too
      const logSnapshot = await getDocs(collection(db, 'logs'));
      const deletePromises = logSnapshot.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch (error) {
      console.error("Error resetting scores", error);
    }
  };

  const renderTally = (count: number) => {
    const groups = Math.floor(count / 5);
    const remainder = count % 5;
    
    return (
      <div className="tally-container">
        {Array.from({ length: groups }).map((_, i) => (
          <div key={`group-${i}`} className="tally-group">
            <div className="tally-stroke" />
            <div className="tally-stroke" />
            <div className="tally-stroke" />
            <div className="tally-stroke" />
            <div className="tally-stroke-diagonal" />
          </div>
        ))}
        {Array.from({ length: remainder }).map((_, i) => (
          <div key={`rem-${i}`} className="tally-stroke mx-0.5" />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-bounce">
          <Bike size={48} className="text-blue-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 pb-24 min-h-screen flex flex-col">
      <header className="flex flex-col items-center mb-8 pt-4">
        <div className="bg-zinc-900 p-3 rounded-xl text-white border-2 border-white shadow-[4px_4px_0px_rgba(0,0,0,1)] mb-3">
          <Bike size={32} />
        </div>
        <h1 className="text-3xl font-black text-zinc-900 uppercase tracking-tight text-center">
          Weinkasse<br/>Strichliste
        </h1>
      </header>

      <main className="flex-grow space-y-8">
        <div className="text-center">
          <span className="bg-zinc-900 text-white px-4 py-1 rounded-full text-sm font-black uppercase tracking-widest border-2 border-white shadow-[2px_2px_0px_rgba(0,0,0,1)]">
            Pro | = 2€
          </span>
        </div>
        <section className="game-card p-6">
          <h2 className="text-xl font-black mb-6 text-center text-zinc-900 uppercase">
            Who road without a helmet?
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {PLAYERS.map((player) => (
              <button
                key={player}
                onClick={() => addPoint(player)}
                disabled={isAdding}
                className="game-button p-4 flex flex-col items-center gap-2"
              >
                <div className="w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center border-2 border-zinc-900">
                  <UserIcon className="text-zinc-900" size={24} />
                </div>
                <span className="font-black text-zinc-900 uppercase text-sm">{player}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-black px-2 text-zinc-900 uppercase flex items-center gap-2">
            Scoreboard
          </h3>
          <div className="space-y-4">
            {PLAYERS.map((player) => (
              <motion.div 
                key={`score-${player}`}
                layout
                className="game-card p-4 flex items-center justify-between"
              >
                <div className="flex flex-col gap-2">
                  <span className="font-black text-zinc-900 uppercase text-sm border-b-2 border-zinc-200 pb-1">{player}</span>
                  {renderTally(scores[player] || 0)}
                </div>
                <div className="text-3xl font-black text-zinc-900 bg-white border-4 border-zinc-900 w-14 h-14 flex items-center justify-center rounded-lg shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                  {scores[player] || 0}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <footer className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex gap-4">
        <button
          onClick={undoLastAction}
          disabled={logs.length === 0}
          className="flex-1 game-button game-button-amber font-black py-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale uppercase"
        >
          <RotateCcw size={20} />
          Undo
        </button>
        <button
          onClick={resetAll}
          className="game-button game-button-red p-4 flex items-center justify-center"
          title="Reset All"
        >
          <Trash2 size={24} />
        </button>
      </footer>

      <AnimatePresence>
        {fallingHelmets.map(h => (
          <motion.div
            key={h.id}
            initial={{ y: -100, x: `${h.x}%`, rotate: 0, opacity: 1 }}
            animate={{ y: '110vh', rotate: 360 }}
            transition={{ 
              duration: h.speed, 
              delay: h.delay,
              ease: "linear" 
            }}
            className="fixed z-[100] pointer-events-none"
            style={{ width: '50px', height: '50px' }}
          >
            <img 
              src="https://cdn-icons-png.flaticon.com/512/3198/3198344.png" 
              alt="Helmet" 
              className="w-full h-full object-contain drop-shadow-lg"
              referrerPolicy="no-referrer"
            />
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/20 backdrop-blur-[2px] z-50 pointer-events-none"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
