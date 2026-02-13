import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import './RoomPage.css'

const PHASE_NAMES: Record<string, string> = {
  LOBBY: '等待开始',
  DEAL: '发牌中',
  SPEAKING: '发言阶段',
  VOTING: '投票阶段',
  RESOLVE: '结算中',
  END: '游戏结束'
}

function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { 
    roomState, 
    isConnected, 
    error, 
    leaveRoom, 
    startGame, 
    speak, 
    vote,
    clearError,
    connect
  } = useGameStore()

  const [speech, setSpeech] = useState('')
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [hasVoted, setHasVoted] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!roomState && roomId) {
      // Try to reconnect if we have a token
      const token = localStorage.getItem('resumeToken')
      if (token) {
        connect()
      } else {
        // No token, redirect to home
        navigate('/')
      }
    }
  }, [roomState, roomId])

  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  useEffect(() => {
    if (roomState?.deadlineTs) {
      const updateTimer = () => {
        const remaining = Math.max(0, Math.ceil((roomState.deadlineTs! - Date.now()) / 1000))
        setTimeLeft(remaining)
        
        if (remaining > 0) {
          timerRef.current = setTimeout(updateTimer, 1000)
        }
      }
      
      updateTimer()
      
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }
      }
    } else {
      setTimeLeft(null)
    }
  }, [roomState?.deadlineTs])

  useEffect(() => {
    // Reset voted status when entering voting phase
    if (roomState?.phase === 'VOTING') {
      setHasVoted(false)
    }
  }, [roomState?.phase, roomState?.round])

  const handleLeave = () => {
    leaveRoom()
    navigate('/')
  }

  const handleStartGame = () => {
    startGame()
  }

  const handleSpeak = () => {
    if (speech.trim()) {
      speak(speech.trim())
      setSpeech('')
    }
  }

  const handleVote = (toSeat: number) => {
    vote(toSeat)
    setHasVoted(true)
  }

  if (!roomState) {
    return (
      <div className="room-page">
        <div className="waiting-message">
          {isConnected ? '正在加载房间...' : '正在连接服务器...'}
        </div>
      </div>
    )
  }

  const isMyTurn = roomState.currentSpeaker === roomState.mySeat
  const myPlayer = roomState.players.find(p => p.seat === roomState.mySeat)
  const alivePlayers = roomState.players.filter(p => p.isAlive)
  const reveal = (window as any).gameReveal

  return (
    <div className="room-page">
      <div className="room-header">
        <h1>房间</h1>
        <div className="room-id">{roomState.roomId}</div>
        <button className="leave-btn" onClick={handleLeave}>离开房间</button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      <div className="game-info">
        <div>
          <span className={`phase-badge ${roomState.phase}`}>
            {PHASE_NAMES[roomState.phase] || roomState.phase}
          </span>
          {roomState.phase !== 'LOBBY' && roomState.phase !== 'END' && (
            <span style={{ marginLeft: '12px', color: '#666' }}>
              第 {roomState.round} 轮
            </span>
          )}
        </div>
        {timeLeft !== null && timeLeft > 0 && (
          <div className="countdown">剩余时间: {timeLeft} 秒</div>
        )}
      </div>

      {roomState.phase === 'END' && reveal && (
        <div className={`game-result ${reveal.winner}`}>
          <h2>
            {reveal.winner === 'civilian' ? '平民获胜！' : '卧底获胜！'}
          </h2>
          <div className="reveal-section">
            <h3>身份揭晓</h3>
            <div className="reveal-list">
              {reveal.rolesBySeat.map((item: any) => (
                <div key={item.seat} className="reveal-item">
                  座位 {item.seat}: {item.role === 'civilian' ? '平民' : '卧底'}
                  {!item.isAlive && ' (已淘汰)'}
                </div>
              ))}
            </div>
            <div className="words-reveal">
              <div className="word-box civilian">
                <h4>平民词</h4>
                <div className="word">{reveal.words.civilian}</div>
              </div>
              <div className="word-box undercover">
                <h4>卧底词</h4>
                <div className="word">{reveal.words.undercover}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {roomState.phase !== 'LOBBY' && roomState.myRole && (
        <div className="my-info">
          <h3>我的信息</h3>
          <div className="role-info">
            <div className="role-label">你的身份</div>
            <div className={`role-value ${roomState.myRole}`}>
              {roomState.myRole === 'civilian' ? '平民' : '卧底'}
            </div>
          </div>
          <div className="role-info" style={{ marginTop: '12px' }}>
            <div className="role-label">你看到的词</div>
            <div className="word-value">{roomState.myWord}</div>
          </div>
        </div>
      )}

      <div className="seats-grid">
        {[1, 2, 3, 4].map((seatNum) => {
          const player = roomState.players.find(p => p.seat === seatNum)
          const isCurrentPlayer = seatNum === roomState.mySeat
          const isCurrentSpeaker = seatNum === roomState.currentSpeaker
          
          if (!player) {
            return (
              <div key={seatNum} className="seat empty">
                <div className="seat-number">{seatNum}</div>
                <div className="nickname">空座位</div>
              </div>
            )
          }

          return (
            <div 
              key={seatNum} 
              className={`seat 
                ${isCurrentPlayer ? 'current-player' : ''} 
                ${isCurrentSpeaker ? 'current-speaker' : ''}
                ${!player.isAlive ? 'eliminated' : ''}
              `}
            >
              <div className="seat-number">{seatNum}</div>
              {player.isAI && <div className="ai-badge">AI</div>}
              {!player.isAlive && <div className="dead-badge">已淘汰</div>}
              <div className="nickname">{player.nickname}</div>
              {isCurrentPlayer && <div style={{fontSize: '0.8rem', color: '#4a90d9'}}>(你)</div>}
            </div>
          )
        })}
      </div>

      {roomState.phase === 'LOBBY' && roomState.isHost && (
        <button className="start-btn" onClick={handleStartGame}>
          开始游戏 ({roomState.players.filter(p => !p.isAI).length} 人)
        </button>
      )}

      {roomState.phase === 'LOBBY' && !roomState.isHost && (
        <div className="waiting-message">
          等待房主开始游戏...
        </div>
      )}

      {roomState.phase === 'SPEAKING' && isMyTurn && (
        <div className="action-section">
          <h3>轮到你发言</h3>
          <input
            type="text"
            className="speak-input"
            placeholder="输入你的发言（30字以内）..."
            value={speech}
            onChange={(e) => setSpeech(e.target.value)}
            maxLength={30}
            onKeyPress={(e) => e.key === 'Enter' && handleSpeak()}
          />
          <button className="btn-primary" onClick={handleSpeak} disabled={!speech.trim()}>
            提交发言
          </button>
        </div>
      )}

      {roomState.phase === 'SPEAKING' && !isMyTurn && (
        <div className="waiting-message">
          等待其他玩家发言...
        </div>
      )}

      {roomState.phase === 'VOTING' && myPlayer?.isAlive && !hasVoted && (
        <div className="action-section">
          <h3>投票环节</h3>
          <div className="voting-options">
            {alivePlayers.map(player => (
              <button
                key={player.seat}
                className={`vote-btn ${player.seat === roomState.mySeat ? 'self' : ''}`}
                onClick={() => handleVote(player.seat)}
                disabled={player.seat === roomState.mySeat}
              >
                投给 {player.nickname} (座位 {player.seat})
                {player.seat === roomState.mySeat && ' (自己)'}
              </button>
            ))}
            <button className="vote-btn abstain" onClick={() => handleVote(0)}>
              弃权
            </button>
          </div>
        </div>
      )}

      {roomState.phase === 'VOTING' && (hasVoted || !myPlayer?.isAlive) && (
        <div className="waiting-message">
          {hasVoted ? '已投票，等待其他玩家...' : '你已淘汰，等待投票结果...'}
        </div>
      )}

      {roomState.speeches.length > 0 && (
        <div className="speeches-section">
          <h3>发言记录</h3>
          {roomState.speeches.map((speech, index) => (
            <div key={index} className="speech-item">
              <div className="speech-header">
                <span>座位 {speech.seat} - 第 {speech.round} 轮</span>
              </div>
              <div className="speech-text">{speech.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default RoomPage
