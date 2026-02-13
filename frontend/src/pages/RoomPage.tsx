import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import './RoomPage.css';

const PHASE_TEXT: Record<string, string> = {
  LOBBY: '等待开始',
  DEAL: '发词中',
  SPEAKING: '发言阶段',
  VOTING: '投票阶段',
  RESOLVE: '结算阶段',
  END: '游戏结束'
};

function RoomPage() {
  const { roomId: roomIdParam = '' } = useParams();
  const navigate = useNavigate();
  const [speechInput, setSpeechInput] = useState('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [hasVoted, setHasVoted] = useState(false);

  const {
    connected,
    error,
    clearError,
    nickname,
    setNickname,
    roomState,
    voteResult,
    gameEnd,
    joinRoom,
    leaveRoom,
    startGame,
    speak,
    vote
  } = useGameStore();

  const roomId = roomIdParam.toUpperCase();
  const inCurrentRoom = roomState?.roomId === roomId;

  const voteCycleKey = `${roomState?.round ?? 0}-${roomState?.phase ?? 'NONE'}-${
    roomState?.tieBreakCandidates.join(',') ?? ''
  }`;

  useEffect(() => {
    setHasVoted(false);
  }, [voteCycleKey]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => clearError(), 4000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  useEffect(() => {
    const deadline = roomState?.deadlineTs;
    if (!deadline) {
      setTimeLeft(null);
      return;
    }

    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(seconds);
    };

    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [roomState?.deadlineTs]);

  const alivePlayers = useMemo(() => {
    return roomState?.players.filter((player) => player.isAlive) ?? [];
  }, [roomState?.players]);

  const voteTargets = useMemo(() => {
    if (!roomState) {
      return [];
    }
    if (roomState.tieBreakCandidates.length === 0) {
      return alivePlayers;
    }
    return alivePlayers.filter((player) => roomState.tieBreakCandidates.includes(player.seat));
  }, [alivePlayers, roomState]);

  if (!roomId) {
    return (
      <div className="room-page">
        <div className="waiting-message">房间号无效</div>
      </div>
    );
  }

  if (!inCurrentRoom) {
    return (
      <div className="room-page">
        <div className="room-header">
          <h1>加入房间</h1>
          <div className="room-id">{roomId}</div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="action-section">
          <h3>通过邀请链接加入</h3>
          <p style={{ marginBottom: 12, color: '#666' }}>请输入昵称后即可进入房间。</p>
          <input
            className="speak-input"
            placeholder="输入昵称（最多12字）"
            maxLength={12}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
          <button
            className="btn-primary"
            disabled={!connected || !nickname.trim()}
            onClick={() => joinRoom(roomId, nickname)}
          >
            立即加入
          </button>
          <button className="leave-btn" style={{ marginTop: 12, width: '100%' }} onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const mySeat = roomState.mySeat;
  const myPlayer = roomState.players.find((player) => player.seat === mySeat);
  const myAlive = Boolean(myPlayer?.isAlive);
  const myTurn = roomState.phase === 'SPEAKING' && roomState.currentSpeaker === mySeat && myAlive;
  const votingNow = roomState.phase === 'VOTING' && myAlive;

  const handleLeave = () => {
    leaveRoom();
    navigate('/');
  };

  const inviteLink = `${window.location.origin}/#/room/${roomState.roomId}`;

  return (
    <div className="room-page">
      <div className="room-header">
        <h1>房间</h1>
        <div className="room-id">{roomState.roomId}</div>
        <button className="leave-btn" onClick={handleLeave}>
          离开
        </button>
      </div>

      {!connected && <div className="error-banner">连接已断开，正在自动重连...</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="game-info">
        <div>
          <span className={`phase-badge ${roomState.phase}`}>{PHASE_TEXT[roomState.phase] ?? roomState.phase}</span>
          {roomState.phase !== 'LOBBY' && roomState.phase !== 'END' && (
            <span style={{ marginLeft: 12, color: '#666' }}>第 {roomState.round} 轮</span>
          )}
        </div>
        {timeLeft !== null && roomState.phase !== 'END' && (
          <div className="countdown">剩余时间: {timeLeft} 秒</div>
        )}
        {roomState.phase === 'LOBBY' && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#666', wordBreak: 'break-all' }}>
            邀请链接: {inviteLink}
          </div>
        )}
      </div>

      {roomState.phase !== 'LOBBY' && roomState.myRole && (
        <div className="my-info">
          <h3>我的身份信息</h3>
          <div className="role-info">
            <div className="role-label">身份</div>
            <div className={`role-value ${roomState.myRole}`}>
              {roomState.myRole === 'civilian' ? '平民' : '卧底'}
            </div>
          </div>
          <div className="role-info" style={{ marginTop: 12 }}>
            <div className="role-label">你的词</div>
            <div className="word-value">{roomState.myWord}</div>
          </div>
        </div>
      )}

      {voteResult && (
        <div className="action-section" style={{ marginBottom: 12 }}>
          <h3>本轮投票结果</h3>
          <p style={{ color: '#555' }}>
            {voteResult.eliminatedSeat
              ? `淘汰座位 ${voteResult.eliminatedSeat}`
              : voteResult.tie
                ? '平票，进入加赛投票'
                : '暂无淘汰'}
          </p>
        </div>
      )}

      {gameEnd && (
        <div className={`game-result ${gameEnd.winner}`}>
          <h2>{gameEnd.winner === 'civilian' ? '平民获胜！' : '卧底获胜！'}</h2>
          <div className="reveal-section">
            <h3>身份揭晓</h3>
            <div className="reveal-list">
              {gameEnd.reveal.rolesBySeat.map((item) => (
                <div key={item.seat} className="reveal-item">
                  座位{item.seat} {item.nickname}: {item.role === 'civilian' ? '平民' : '卧底'}
                  {!item.isAlive && ' (已淘汰)'}
                </div>
              ))}
            </div>
            <div className="words-reveal">
              <div className="word-box civilian">
                <h4>平民词</h4>
                <div className="word">{gameEnd.reveal.words.civilian}</div>
              </div>
              <div className="word-box undercover">
                <h4>卧底词</h4>
                <div className="word">{gameEnd.reveal.words.undercover}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="seats-grid">
        {[1, 2, 3, 4].map((seat) => {
          const player = roomState.players.find((item) => item.seat === seat);
          if (!player) {
            return (
              <div key={seat} className="seat empty">
                <div className="seat-number">{seat}</div>
                <div className="nickname">空座位</div>
              </div>
            );
          }

          const current = roomState.currentSpeaker === seat;
          const me = roomState.mySeat === seat;
          return (
            <div
              key={seat}
              className={`seat ${me ? 'current-player' : ''} ${current ? 'current-speaker' : ''} ${
                !player.isAlive ? 'eliminated' : ''
              }`}
            >
              <div className="seat-number">{seat}</div>
              {player.isAI && <div className="ai-badge">AI</div>}
              {!player.isAI && !player.connected && player.isAlive && <div className="ai-badge">离线</div>}
              {!player.isAlive && <div className="dead-badge">已淘汰</div>}
              <div className="nickname">{player.nickname}</div>
              {me && <div style={{ fontSize: 12, color: '#4a90d9' }}>(你)</div>}
            </div>
          );
        })}
      </div>

      {roomState.phase === 'LOBBY' && roomState.isHost && (
        <button className="start-btn" onClick={startGame}>
          开始游戏（真人 {roomState.players.filter((player) => !player.isAI).length} 人）
        </button>
      )}

      {roomState.phase === 'LOBBY' && !roomState.isHost && (
        <div className="waiting-message">等待房主开始游戏...</div>
      )}

      {myTurn && (
        <div className="action-section">
          <h3>轮到你发言</h3>
          <input
            className="speak-input"
            maxLength={30}
            placeholder="输入你的发言（30字以内）"
            value={speechInput}
            onChange={(event) => setSpeechInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && speechInput.trim()) {
                speak(speechInput);
                setSpeechInput('');
              }
            }}
          />
          <button
            className="btn-primary"
            disabled={!speechInput.trim()}
            onClick={() => {
              speak(speechInput);
              setSpeechInput('');
            }}
          >
            提交发言
          </button>
        </div>
      )}

      {roomState.phase === 'SPEAKING' && !myTurn && <div className="waiting-message">等待当前玩家发言...</div>}

      {votingNow && !hasVoted && (
        <div className="action-section">
          <h3>{roomState.tieBreakCandidates.length ? '加赛投票' : '投票阶段'}</h3>
          <div className="voting-options">
            {voteTargets.map((player) => (
              <button
                key={player.seat}
                className={`vote-btn ${player.seat === mySeat ? 'self' : ''}`}
                disabled={player.seat === mySeat}
                onClick={() => {
                  vote(player.seat);
                  setHasVoted(true);
                }}
              >
                投给 {player.nickname}（座位{player.seat}）
              </button>
            ))}
            <button
              className="vote-btn abstain"
              onClick={() => {
                vote(0);
                setHasVoted(true);
              }}
            >
              弃权
            </button>
          </div>
        </div>
      )}

      {roomState.phase === 'VOTING' && (!myAlive || hasVoted) && (
        <div className="waiting-message">{myAlive ? '已投票，等待其他玩家...' : '你已淘汰，等待投票结果...'}</div>
      )}

      <div className="speeches-section">
        <h3>公共发言记录</h3>
        {roomState.speeches.length === 0 && <div className="no-speeches">暂无发言</div>}
        {roomState.speeches.map((speech, index) => (
          <div className="speech-item" key={`${speech.round}-${speech.seat}-${index}`}>
            <div className="speech-header">
              <span>
                第{speech.round}轮 座位{speech.seat}
              </span>
            </div>
            <div className="speech-text">{speech.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RoomPage;
