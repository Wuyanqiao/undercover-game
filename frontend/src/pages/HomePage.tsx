import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import './HomePage.css';

function HomePage() {
  const [roomId, setRoomId] = useState('');
  const {
    connected,
    error,
    nickname,
    setNickname,
    createRoom,
    joinRoom,
    clearError
  } = useGameStore();

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => clearError(), 4000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  return (
    <div className="home-page">
      <h1>谁是卧底</h1>
      <p className="subtitle">2~4 真人，自动 AI 补位到 4 座</p>

      <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
        {connected ? '服务器已连接' : '连接中...'}
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="card">
        <h2>你的昵称</h2>
        <div className="input-group">
          <input
            type="text"
            placeholder="输入昵称（最多12字）"
            maxLength={12}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
        </div>
        <button
          className="btn-primary"
          disabled={!connected || !nickname.trim()}
          onClick={() => createRoom(nickname)}
        >
          创建房间
        </button>
      </div>

      <div className="divider">或</div>

      <div className="card">
        <h2>加入房间</h2>
        <div className="input-group">
          <input
            type="text"
            placeholder="输入 6 位房间号"
            maxLength={6}
            value={roomId}
            onChange={(event) => setRoomId(event.target.value.toUpperCase())}
          />
        </div>
        <button
          className="btn-primary"
          disabled={!connected || !nickname.trim() || roomId.trim().length < 6}
          onClick={() => joinRoom(roomId, nickname)}
        >
          加入房间
        </button>
      </div>
    </div>
  );
}

export default HomePage;
