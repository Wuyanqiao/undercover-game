import { useState, useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import './HomePage.css'

function HomePage() {
  const [nickname, setNickname] = useState('')
  const [roomId, setRoomId] = useState('')
  const { connect, disconnect, isConnected, error, createRoom, joinRoom, clearError } = useGameStore()

  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [])

  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  const handleCreateRoom = () => {
    if (nickname.trim()) {
      createRoom(nickname.trim())
    }
  }

  const handleJoinRoom = () => {
    if (nickname.trim() && roomId.trim()) {
      joinRoom(roomId.trim(), nickname.trim())
    }
  }

  return (
    <div className="home-page">
      <h1>谁是卧底</h1>
      <p className="subtitle">在线多人游戏</p>

      <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
        {isConnected ? '已连接到服务器' : '正在连接服务器...'}
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="card">
        <h2>创建房间</h2>
        <div className="input-group">
          <label>你的昵称</label>
          <input
            type="text"
            placeholder="输入昵称"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={12}
          />
        </div>
        <button 
          className="btn-primary" 
          onClick={handleCreateRoom}
          disabled={!nickname.trim() || !isConnected}
        >
          创建房间
        </button>
      </div>

      <div className="divider">或</div>

      <div className="card">
        <h2>加入房间</h2>
        <div className="input-group">
          <label>你的昵称</label>
          <input
            type="text"
            placeholder="输入昵称"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={12}
          />
        </div>
        <div className="input-group">
          <label>房间号</label>
          <input
            type="text"
            placeholder="输入房间号"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            maxLength={6}
          />
        </div>
        <button 
          className="btn-primary" 
          onClick={handleJoinRoom}
          disabled={!nickname.trim() || !roomId.trim() || !isConnected}
        >
          加入房间
        </button>
      </div>
    </div>
  )
}

export default HomePage
