import { useEffect } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { useGameStore } from './store/gameStore'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import './App.css'

function App() {
  const navigate = useNavigate()
  const { ensureSocket, socket } = useGameStore()

  useEffect(() => {
    ensureSocket()
  }, [ensureSocket])

  useEffect(() => {
    if (!socket) {
      return
    }

    const onJoined = ({ roomId }: { roomId: string }) => {
      navigate(`/room/${roomId}`)
    }

    socket.on('room:joined', onJoined)

    return () => {
      socket.off('room:joined', onJoined)
    }
  }, [socket, navigate])

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </div>
  )
}

export default App
